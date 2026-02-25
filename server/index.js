const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files — disable cache for JS so browser always gets fresh code
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});
app.use(express.static(path.join(__dirname, '..')));

// Set up cookies for yt-dlp to bypass YouTube anti-bot/age-restrictions
// Use /tmp so it's always writable on any Linux container (Railway, Render, Fly, etc.)
const os = require('os');
const COOKIES_TMP_PATH = path.join(os.tmpdir(), 'yt_cookies.txt');

function getCookiesArgs() {
  if (process.env.YOUTUBE_COOKIES) {
    try {
      const cookieString = Buffer.from(process.env.YOUTUBE_COOKIES, 'base64').toString('utf-8');
      if (cookieString.startsWith('# Netscape HTTP Cookie File')) {
        fs.writeFileSync(COOKIES_TMP_PATH, cookieString, { encoding: 'utf-8' });
        return ['--cookies', COOKIES_TMP_PATH];
      } else {
        console.warn('[WARN] YOUTUBE_COOKIES is corrupted or not in Netscape format. Ignoring.');
      }
    } catch (err) {
      console.error('[ERROR] Failed to write YOUTUBE_COOKIES dynamically:', err.message);
    }
  } else if (fs.existsSync(COOKIES_TMP_PATH)) {
    const localCookies = fs.readFileSync(COOKIES_TMP_PATH, 'utf-8');
    if (localCookies.startsWith('# Netscape HTTP Cookie File')) {
      return ['--cookies', COOKIES_TMP_PATH];
    }
  }
  return [];
}

function getYouTubeClient() {
  // Use YOUTUBE_CLIENT env var to override; default lets yt-dlp select the best clients
  // Natively evaluated by Node.js integration
  return process.env.YOUTUBE_CLIENT || 'default';
}

// Returns extractor-args for YouTube — using native yt-dlp js_engine
function getExtractorArgs(url, clientOverride = null) {
  const isYouTube = url && (url.includes('youtube.com') || url.includes('youtu.be'));
  if (!isYouTube) return [];
  const client = clientOverride || getYouTubeClient();

  // Forcing Node.js to natively solve all JS signatures internally + query local bgutil server
  const baseArgs = [
    '--js-runtimes', 'node',
    '--extractor-args', `youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416`
  ];

  if (client === 'default') {
    return [...baseArgs, '--extractor-args', 'youtube:player_client=ios,tv,mweb'];
  }
  return [...baseArgs, '--extractor-args', `youtube:player_client=${client}`];
}


// ─── Cobalt.tools API helpers ────────────────────────────────────────────────
// Cobalt is a free, open-source download API that bypasses YouTube's datacenter
// IP blocks. Used as an automatic fallback when yt-dlp fails for YouTube URLs.

async function cobaltFetch(url, { isAudio = false, quality = 'max' } = {}) {
  const resp = await fetch('https://api.cobalt.tools/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      url,
      downloadMode: isAudio ? 'audio' : 'auto',
      videoQuality: quality === 'max' || !quality ? 'max' : quality,
      filenameStyle: 'basic',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Cobalt API HTTP ${resp.status}`);
  return resp.json();
}

async function youtubeOEmbed(url) {
  const resp = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!resp.ok) throw new Error(`oEmbed HTTP ${resp.status}`);
  return resp.json();
}

// Standard quality options offered when cobalt is used
const COBALT_FORMATS = [
  { format_id: 'cobalt_max', resolution: 'Best', ext: 'mp4', note: '⚡ via cobalt' },
  { format_id: 'cobalt_1080', resolution: '1080p', ext: 'mp4', note: '⚡ via cobalt' },
  { format_id: 'cobalt_720', resolution: '720p', ext: 'mp4', note: '⚡ via cobalt' },
  { format_id: 'cobalt_480', resolution: '480p', ext: 'mp4', note: '⚡ via cobalt' },
  { format_id: 'cobalt_360', resolution: '360p', ext: 'mp4', note: '⚡ via cobalt' },
  { format_id: 'cobalt_audio', resolution: 'audio', ext: 'mp3', note: '⚡ via cobalt' },
];
// ─────────────────────────────────────────────────────────────────────────────

// In-memory job store
const jobs = {};

// Find yt-dlp executable
const { execSync } = require('child_process');
let YT_DLP_CMD = 'yt-dlp';
try {
  execSync('yt-dlp --version', { stdio: 'ignore' });
  console.log('yt-dlp found in PATH');
} catch {
  try {
    execSync('python -m yt_dlp --version', { stdio: 'ignore' });
    YT_DLP_CMD = 'python -m yt_dlp';
    console.log('yt-dlp found via python -m yt_dlp');
  } catch {
    try {
      execSync('python3 -m yt_dlp --version', { stdio: 'ignore' });
      YT_DLP_CMD = 'python3 -m yt_dlp';
      console.log('yt-dlp found via python3 -m yt_dlp');
    } catch {
      console.warn('WARNING: yt-dlp not found! Install with: pip install yt-dlp');
    }
  }
}
console.log(`Using yt-dlp command: ${YT_DLP_CMD}`);


// Add browser User-Agent for social platforms (Facebook, Instagram etc. block non-browser requests)
function getImpersonationArgs(url) {
  if (!url) return [];
  const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
  if (isYouTube) return [];
  const isSocial = url.includes('facebook.com') || url.includes('fb.com') ||
    url.includes('instagram.com') || url.includes('twitter.com') ||
    url.includes('tiktok.com');
  if (isSocial) {
    return ['--add-header', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'];
  }
  return [];
}

// Check for ffmpeg (needed to merge video+audio streams for 1080p+)
let HAS_FFMPEG = false;
let FFMPEG_PATH = null;

// On Windows: check local server/ffmpeg.exe; on Linux: rely on system PATH
const FFMPEG_LOCAL_WIN = path.join(__dirname, 'ffmpeg.exe');
if (process.platform === 'win32' && fs.existsSync(FFMPEG_LOCAL_WIN)) {
  HAS_FFMPEG = true;
  FFMPEG_PATH = FFMPEG_LOCAL_WIN;
  console.log(`ffmpeg found locally (Windows): ${FFMPEG_LOCAL_WIN} ✅`);
} else {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    HAS_FFMPEG = true;
    FFMPEG_PATH = 'ffmpeg';
    console.log('ffmpeg found in system PATH ✅');
  } catch {
    console.warn('ffmpeg NOT found — downloads will use pre-merged streams (720p max).');
  }
}

function spawnYtDlp(args, options = {}) {
  // YT_DLP_CMD may be a multi-word string like 'python -m yt_dlp'.
  // spawn() does NOT use a shell by default, so we must split it ourselves.
  const parts = YT_DLP_CMD.split(' ');
  const cmd = parts[0];            // e.g. 'python'
  const pre = parts.slice(1);      // e.g. ['-m', 'yt_dlp']

  // Guarantee node's location is in PATH for yt-dlp to find the JS Challenge Provider
  // Use process.execPath to get the absolute path to the current Node executable
  const nodeDir = require('path').dirname(process.execPath);
  const pathEnv = [nodeDir, process.env.PATH, '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(path.delimiter);

  // Provide GetPOT with local script path if docker symlink is missing
  const potPath = path.join(__dirname, '../bgutil-server/build');
  const env = {
    ...process.env,
    ...(options.env || {}),
    PATH: pathEnv,
    // Add env vars if bgutil supports reading location via env (it usually defaults to /root/bgutil... or cwd)
    BGUTIL_YTDLP_POT_PROVIDER_SERVER_BUILD_DIR: potPath,
    POT_PROVIDER_DIR: potPath
  };

  return spawn(cmd, [...pre, ...args], { ...options, env });
}

// Build a safe format string depending on ffmpeg availability
function buildFormatArg(format_id, isAudio) {
  if (isAudio) {
    // Audio: always works, no merging needed
    return 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio';
  }
  if (format_id && format_id !== 'auto') {
    // Specific format selected by user — always add generous fallbacks in case
    // the exact format_id is unavailable on this server's IP/client combination
    if (HAS_FFMPEG) {
      return `${format_id}+bestaudio[ext=m4a]/${format_id}+bestaudio/${format_id}/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[vcodec!=none]/best`;
    }
    return `${format_id}/best[ext=mp4][vcodec!=none]/best[vcodec!=none]/best`;
  }
  // Auto mode
  if (HAS_FFMPEG) {
    // Prefer mp4 container with merged streams, fallback to any best video+audio, then best single file
    return 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[vcodec!=none]/best';
  }
  // No ffmpeg — use pre-merged mp4 streams only (avoids webm), demand video codec
  return 'best[ext=mp4][vcodec!=none]/best[height<=720][vcodec!=none]/best[vcodec!=none]/best';
}

// Safe filename sanitiser
function safeFilename(title, ext) {
  const name = (title || 'downfiles')
    .replace(/[\\/:*?"<>|]/g, '_')  // Remove illegal filename chars
    .replace(/\s+/g, '_')           // Spaces → underscores
    .replace(/[^\x20-\x7E]/g, '')   // Strip non-ASCII (emoji, unicode scripts)
    .replace(/_+/g, '_')            // Collapse multiple underscores
    .replace(/^_|_$/g, '')          // Trim leading/trailing underscores
    .slice(0, 80) || 'downfiles';   // Fallback if title was all non-ASCII
  return `${name}.${ext}`;
}

// Set Content-Disposition header safely (RFC 5987 for Unicode titles)
function setDownloadFilename(res, title, ext) {
  const ascii = safeFilename(title, ext);
  // RFC 5987: filename*=UTF-8''<percent-encoded> for full Unicode support
  const encoded = encodeURIComponent((title || 'downfiles').slice(0, 200)) + '.' + ext;
  res.setHeader('Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`);
}

// GET /api/yt-debug - shows raw yt-dlp output for debugging
app.get('/api/yt-debug', (req, res) => {
  const url = req.query.url || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  const playerClient = req.query.client || getYouTubeClient();
  const cookiesArr = req.query.nocookies ? [] : getCookiesArgs();
  const hasCookies = req.query.nocookies ? false : fs.existsSync(COOKIES_TMP_PATH);

  const isFormatList = !!req.query.F;

  const dbgArgs = [
    isFormatList ? '-F' : '--dump-json',
    '--no-playlist', '--no-warnings', '--verbose',
    ...getImpersonationArgs(url),
    '--add-header', 'Accept-Language: en-US,en;q=0.9',
    ...getExtractorArgs(url, playerClient),
    '--rm-cache-dir',
    '--socket-timeout', '20',
    ...cookiesArr,
    url
  ];
  let out = '', err = '';
  const p2 = spawnYtDlp(dbgArgs);
  p2.on('error', (err) => { err += `\n[SPAWN ERROR] ${err.message}`; console.error('yt-dlp spawn error', err); });
  p2.stdout.on('data', d => { out += d; });
  p2.stderr.on('data', d => { err += d; });
  let ytDlpVersion = 'unknown';
  try {
    ytDlpVersion = require('child_process').execSync(`${YT_DLP_CMD} --version`).toString().trim();
  } catch (e) { }

  p2.on('close', c => res.json({
    code: c, hasCookies,
    hasEnvVar: !!process.env.YOUTUBE_COOKIES,
    clientUsed: playerClient,
    ytDlpVersion: ytDlpVersion,
    cookiesTmpPath: COOKIES_TMP_PATH,
    stderr: err.slice(0, 5000), stdout_len: out.length,
    stdout: out.slice(0, 50000)
  }));
});

// POST /api/info - Get video info
app.post('/api/info', async (req, res) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // Strip YouTube playlist/mix params — only keep the video ID
  let videoId = null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      videoId = u.hostname.includes('youtu.be')
        ? u.pathname.replace('/', '')
        : u.searchParams.get('v');
      if (videoId) url = `https://www.youtube.com/watch?v=${videoId}`;
    }
  } catch { }

  console.log(`[INFO] Fetching: ${url}`);
  const isYouTube = !!videoId;

  // ── RapidAPI YouTube Fallback ──
  // Bypasses datacenter blocks cleanly
  if (isYouTube && process.env.RAPID_API_KEY) {
    try {
      console.log('[INFO] YouTube detected — trying RapidAPI fallback...');
      const rapidUrl = `https://youtube-media-downloader.p.rapidapi.com/v2/video/details?videoId=${videoId}`;
      const apiRes = await fetch(rapidUrl, {
        method: 'GET',
        headers: {
          'x-rapidapi-host': 'youtube-media-downloader.p.rapidapi.com',
          'x-rapidapi-key': process.env.RAPID_API_KEY
        },
        signal: AbortSignal.timeout(10000)
      });

      const data = await apiRes.json();
      if (!apiRes.ok || data.message === "You are not subscribed to this API.") {
        console.warn('[INFO] RapidAPI returned error:', data.message || apiRes.status);
      } else if (data.status === false || data.error) {
        console.warn('[INFO] RapidAPI inner error:', data);
      } else {
        // Map RapidAPI response to our format
        console.log('[INFO] RapidAPI succeeded');
        const formats = [];

        // Videos
        if (data.videos && data.videos.items) {
          data.videos.items.forEach((v, i) => {
            formats.push({
              format_id: `rapid_video_${i}`,
              ext: v.extension || 'mp4',
              resolution: v.quality || 'unknown',
              filesize: null,
              vcodec: 'avc1',
              acodec: v.hasAudio ? 'mp4a' : 'none',
              note: `${v.sizeText || ''} ${v.hasAudio ? '(Audio+Video)' : '(Video Only)'}`.trim()
            });
          });
        }

        // Audios
        if (data.audios && data.audios.items) {
          data.audios.items.forEach((a, i) => {
            formats.push({
              format_id: `rapid_audio_${i}`,
              ext: a.extension || 'mp3',
              resolution: 'audio',
              filesize: null,
              vcodec: 'none',
              acodec: 'mp4a',
              note: a.sizeText || 'Audio'
            });
          });
        }

        // Dedup by note/resolution just in case
        const seen = new Set();
        const uniqueFormats = formats.filter(f => {
          const id = f.resolution + f.note;
          if (seen.has(id)) return false;
          seen.add(id); return true;
        });

        const thumb = (data.thumbnails && data.thumbnails.length > 0) ? data.thumbnails[data.thumbnails.length - 1].url : null;

        return res.json({
          title: data.title || 'YouTube Video',
          thumbnail: thumb,
          duration: data.lengthSeconds ? parseInt(data.lengthSeconds) : null,
          uploader: data.author ? data.author.name : 'YouTube',
          platform: 'Youtube',
          webpage_url: url,
          formats: uniqueFormats,
          best_format: formats.length > 0 ? formats[0].format_id : 'auto'
        });
      }
    } catch (rapidErr) {
      console.error('[INFO] RapidAPI fallback failed:', rapidErr.message, '— falling back to yt-dlp');
    }
  }

  // ── yt-dlp path (YouTube fallback + all non-YouTube platforms) ──
  const hasCookies = fs.existsSync(COOKIES_TMP_PATH);
  console.log(`[INFO] Running yt-dlp | cookies: ${hasCookies}`);

  const args = [
    '--dump-json',
    ...(isYouTube ? ['--no-playlist'] : []),
    '--no-warnings',
    ...getImpersonationArgs(url),
    '--add-header', 'Accept-Language: en-US,en;q=0.9',
    ...getExtractorArgs(url),
    '--rm-cache-dir',
    '--socket-timeout', '30',
    ...getCookiesArgs(),
    url
  ];

  let output = '', errOutput = '';
  const proc = spawnYtDlp(args);
  proc.on('error', (err) => {
    console.error('[INFO] yt-dlp spawn error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'yt-dlp failed to start or is not installed. Contact admin.', details: err.message });
  });
  proc.stdout.on('data', d => { output += d.toString(); });
  proc.stderr.on('data', d => { errOutput += d.toString(); process.stdout.write('[yt-dlp] ' + d); });
  proc.on('close', async (code) => {
    console.log(`[INFO] yt-dlp exited with code ${code}`);
    if (res.headersSent) return; // Prevent setting headers again if spawn error already did

    if (code !== 0) {
      let cobaltSucceeded = false;
      // Try cobalt.tools fallback for YouTube before returning error
      if (isYouTube) {
        console.log('[INFO] yt-dlp failed, trying cobalt.tools fallback...');
        try {
          const [oembed, cobalt] = await Promise.all([
            youtubeOEmbed(url),
            cobaltFetch(url, { isAudio: false, quality: 'max' }),
          ]);
          if (cobalt.status === 'tunnel' || cobalt.status === 'redirect' || cobalt.status === 'picker') {
            console.log('[INFO] cobalt fallback succeeded!');
            return res.json({
              title: oembed.title,
              thumbnail: oembed.thumbnail_url,
              duration: null,
              uploader: oembed.author_name,
              platform: 'Youtube',
              formats: COBALT_FORMATS,
              best_format: 'cobalt_max',
              via_cobalt: true,
            });
            cobaltSucceeded = true;
          }
        } catch (cobaltErr) {
          console.error('[INFO] cobalt fallback failed:', cobaltErr.message);
        }
      }

      if (cobaltSucceeded) return; // Prevent sending error response if we already sent JSON

      let friendly = 'Could not fetch video info. Make sure the URL is valid and publicly accessible.';
      if (errOutput.includes('DRM protected')) {
        friendly = 'This video is DRM protected (Premium content) and cannot be downloaded.';
      } else if (errOutput.includes('Sign in') || errOutput.includes('private')) {
        friendly = 'This video is private or requires sign-in.';
      } else if (errOutput.includes('Requested format is not available')) {
        friendly = 'Could not fetch YouTube format due to Bot Verification Block. Try updating your cookies or using client=web,ios.';
      } else if (errOutput.includes('not available in your country') || errOutput.includes('not available in your region')) {
        friendly = 'This video is unavailable in your region or has been removed.';
      }
      return res.status(400).json({ error: friendly, details: errOutput.slice(0, 500) });
    }

    let info;
    try { info = JSON.parse(output); } catch (e) {
      console.error('[INFO] JSON parse failed:', e.message);
      return res.status(500).json({ error: 'Failed to parse video info', details: errOutput.slice(0, 500) || 'empty output' });
    }

    const isYouTubeExtractor = (info.extractor_key || '').toLowerCase().includes('youtube');

    const formats = (info.formats || [])
      .filter(f => f.vcodec !== 'none' || f.acodec !== 'none')
      .map(f => {
        const height = f.height || parseInt(f.resolution) || 0;
        // Let yt-dlp and ffmpeg pick the exact video format ID and merge it with bestaudio later
        const safeFormatId = f.format_id;
        return {
          format_id: safeFormatId,
          ext: f.ext,
          resolution: f.resolution || (height ? `${height}p` : 'audio'),
          filesize: f.filesize || f.filesize_approx || null,
          vcodec: f.vcodec,
          acodec: f.acodec,
          fps: f.fps || null,
          tbr: f.tbr || null,
          note: f.format_note || ''
        };
      })
      .sort((a, b) => {
        const getH = r => parseInt(r) || 0;
        return getH(b.resolution) - getH(a.resolution);
      });

    // Deduplicate by resolution
    const seen = new Set();
    const uniqueFormats = formats.filter(f => {
      const key = f.resolution;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      uploader: info.uploader || info.channel,
      platform: info.extractor_key,
      webpage_url: info.webpage_url,
      formats: uniqueFormats,
      best_format: info.format_id
    });
  });
});

// Download to a temp file, then stream to client.
async function streamDownload(res, req, url, format_id, isAudio, title) {
  // ── Handle RapidAPI Downloads (proxy the direct media URL) ──
  if (format_id && format_id.startsWith('rapid_')) {
    console.log(`[INFO] Streaming via RapidAPI: ${format_id}`);
    try {
      const u = new URL(url);
      const videoId = u.searchParams.get('v') || u.pathname.replace('/', '');
      const rapidUrl = `https://youtube-media-downloader.p.rapidapi.com/v2/video/details?videoId=${videoId}`;
      const apiRes = await fetch(rapidUrl, {
        headers: {
          'x-rapidapi-host': 'youtube-media-downloader.p.rapidapi.com',
          'x-rapidapi-key': process.env.RAPID_API_KEY || ''
        }
      });
      const data = await apiRes.json();

      const isRapidVideo = format_id.startsWith('rapid_video_');
      const rapidIdx = parseInt(format_id.split('_').pop() || '0');
      let mediaUrl = null;
      let ext = 'mp4';

      if (isRapidVideo && data.videos && data.videos.items[rapidIdx]) {
        mediaUrl = data.videos.items[rapidIdx].url;
        ext = data.videos.items[rapidIdx].extension || 'mp4';
      } else if (!isRapidVideo && data.audios && data.audios.items[rapidIdx]) {
        mediaUrl = data.audios.items[rapidIdx].url;
        ext = data.audios.items[rapidIdx].extension || 'mp3';
      }

      if (!mediaUrl) {
        console.error('[INFO] RapidAPI download URL not found for id:', format_id);
        return res.status(404).send('Media format not found via API');
      }

      const safeTitle = (title || data.title || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.${ext}"`);
      if (isRapidVideo) res.setHeader('Content-Type', 'video/mp4');
      else res.setHeader('Content-Type', 'audio/mpeg');

      // Proxy the stream
      const mediaRes = await fetch(mediaUrl);
      if (!mediaRes.ok) throw new Error(`Media fetch failed: ${mediaRes.status}`);

      return mediaRes.body.pipe(res);
    } catch (e) {
      console.error('[INFO] RapidAPI streaming failed:', e);
      if (!res.headersSent) return res.status(500).send('Streaming failed: ' + e.message);
      return;
    }
  }

  // ── Normal yt-dlp Download ──
  const formatArg = buildFormatArg(format_id, isAudio);
  const ext = isAudio ? 'mp3' : 'mp4';
  const contentType = isAudio ? 'audio/mpeg' : 'video/mp4';

  const tmpId = uuidv4();
  const tmpFile = require('path').join(require('os').tmpdir(), `downfiles_${tmpId}.${ext}`);

  const args = [
    '-f', formatArg,
    '--no-playlist',
    ...getImpersonationArgs(url),
    ...getExtractorArgs(url),
    '--add-header', 'Accept-Language: en-US,en;q=0.9',
    '--rm-cache-dir',
    '--socket-timeout', '60',
    '--no-warnings',
    ...getCookiesArgs(),
    '-o', tmpFile
  ];

  if (isAudio) {
    args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
  }

  if (HAS_FFMPEG) {
    // Only pass --ffmpeg-location if it's a specific custom path, otherwise yt-dlp finds it in PATH.
    // Passing '--ffmpeg-location ffmpeg' breaks yt-dlp merging on Linux.
    if (FFMPEG_PATH !== 'ffmpeg') {
      args.push('--ffmpeg-location', FFMPEG_PATH);
    }
    if (!isAudio) args.push('--merge-output-format', 'mp4');
  }

  args.push(url);

  console.log(`[DOWNLOAD] ${url}`);
  console.log(`  format: ${formatArg} | audio: ${isAudio} | ffmpeg: ${HAS_FFMPEG}`);
  console.log(`  tmp: ${tmpFile}`);

  const proc = spawnYtDlp(args);
  proc.on('error', (err) => {
    console.error('[DOWNLOAD] yt-dlp spawn error:', err);
    if (!res.headersSent) res.status(500).send('Download failed: yt-dlp not found or failed to start.');
  });
  let errOutput = '';
  proc.stderr.on('data', d => {
    errOutput += d.toString();
    process.stdout.write('[yt-dlp log] ' + d.toString());
  });
  let stdOutput = '';
  proc.stdout.on('data', d => {
    stdOutput += d.toString();
  });

  proc.on('close', (code) => {
    console.log(`[DOWNLOAD] yt-dlp exited ${code}`);
    if (code !== 0) {
      if (!res.headersSent) res.status(500).send('Download failed: ' + errOutput.slice(0, 200));
      return;
    }

    // Stream the temp file to client, then delete it
    // Wait: what if yt-dlp renamed it? Let's check if it exists:
    let sendFile = tmpFile;
    if (!fs.existsSync(sendFile)) {
      // Find what file yt-dlp actually created
      let tmpFiles = fs.readdirSync(os.tmpdir()).filter(f => f.includes(`downfiles_${tmpId}`));
      if (tmpFiles.length > 0) {
        // Prioritize actual video containers over audio streams in case of unmerged files
        tmpFiles.sort((a, b) => {
          const score = f => f.endsWith('.mp4') ? 1 : f.endsWith('.mkv') ? 2 : f.endsWith('.webm') ? 3 : 4;
          return score(a) - score(b);
        });
        sendFile = path.join(os.tmpdir(), tmpFiles[0]);
      } else {
        return res.status(500).json({
          error: 'Downloaded file not found on server.',
          tmpFileTried: tmpFile,
          ytdlpStderr: errOutput,
          ytdlpStdout: stdOutput
        });
      }
    }

    const cleanup = (f) => { try { fs.unlinkSync(f); } catch { } };

    setDownloadFilename(res, title, ext);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');

    const stream = fs.createReadStream(sendFile);
    stream.on('error', (err) => {
      console.error('[DOWNLOAD] read error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to read downloaded file', msg: err.message, file: sendFile });
    });
    stream.on('end', () => cleanup(sendFile));
    stream.pipe(res);
  });

  req.on('close', () => proc.kill('SIGTERM'));
}

// Helper: handle cobalt download redirect
async function handleCobaltDownload(res, url, format_id, isAudio, title) {
  const quality = (format_id || '').replace('cobalt_', '');
  const isAudioReq = quality === 'audio' || isAudio;
  try {
    const result = await cobaltFetch(url, { isAudio: isAudioReq, quality: isAudioReq ? 'max' : quality });
    if (result.status === 'tunnel' || result.status === 'redirect') {
      setDownloadFilename(res, title, isAudioReq ? 'mp3' : 'mp4');
      return res.redirect(302, result.url);
    }
    return res.status(502).json({ error: 'Cobalt returned unexpected status: ' + result.status });
  } catch (e) {
    console.error('[COBALT] Download failed:', e.message);
    return res.status(502).json({ error: 'Cobalt download failed', msg: e.message });
  }
}

// GET /api/download?url=...&format_id=...&audio_only=1&title=...
app.get('/api/download', async (req, res) => {
  const { url, format_id, audio_only, title } = req.query;
  if (!url) return res.status(400).send('URL is required');
  const isAudio = audio_only === '1' || audio_only === 'true';
  if (format_id && format_id.startsWith('cobalt_')) {
    return handleCobaltDownload(res, url, format_id, isAudio, title);
  }
  streamDownload(res, req, url, format_id, isAudio, title);
});

// POST /api/download - accepts JSON body as well
app.post('/api/download', async (req, res) => {
  const url = req.body?.url;
  const format_id = req.body?.format_id;
  const audio_only = req.body?.audio_only;
  const title = req.body?.title;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  const isAudio = audio_only === '1' || audio_only === 'true' || audio_only === true;
  if (format_id && format_id.startsWith('cobalt_')) {
    return handleCobaltDownload(res, url, format_id, isAudio, title);
  }
  streamDownload(res, req, url, format_id, isAudio, title);
});

// POST /api/download-link - Get download link (for quality picker)
app.post('/api/download-link', (req, res) => {
  const { url, format_id, audio_only } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const jobId = uuidv4();
  jobs[jobId] = { status: 'processing', progress: 0, url, format_id, audio_only };
  res.json({ jobId, downloadUrl: `/api/stream/${jobId}` });
});

// GET /api/stream/:jobId - Stream by job
app.get('/api/stream/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { url, format_id, audio_only } = job;
  let formatArg;
  if (audio_only) {
    formatArg = 'bestaudio[ext=m4a]/bestaudio';
  } else if (format_id && format_id !== 'auto') {
    formatArg = `${format_id}+bestaudio[ext=m4a]/${format_id}+bestaudio/best`;
  } else {
    formatArg = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
  }

  const ext = audio_only ? 'mp3' : 'mp4';
  res.setHeader('Content-Disposition', `attachment; filename="download.${ext}"`);
  res.setHeader('Content-Type', audio_only ? 'audio/mpeg' : 'video/mp4');

  const args = ['-f', formatArg, '--no-playlist', '-o', '-', url];
  const proc = spawnYtDlp(['-f', formatArg, '--no-playlist', '-o', '-', url]);
  proc.stdout.pipe(res);
  req.on('close', () => proc.kill());
});

// GET /api/status/:jobId - Job status
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// GET /api/sysinfo - Debug environment
app.get('/api/sysinfo', (req, res) => {
  try {
    const nodeV = require('child_process').execSync('node -v').toString().trim();
    const pythonV = require('child_process').execSync('python3 --version 2>&1').toString().trim();
    const ytDlpLoc = require('child_process').execSync('which yt-dlp 2>/dev/null || echo not-found').toString().trim();
    const nodeLoc = require('child_process').execSync('which node 2>/dev/null || echo not-found').toString().trim();
    // Test if Python can spawn node (same way yt-dlp does internally)
    let pythonCanSpawnNode = 'FAILED';
    try {
      pythonCanSpawnNode = require('child_process').execSync(
        `python3 -c "import subprocess; r=subprocess.run(['node','-e','process.stdout.write(String(40+2))'], capture_output=True, text=True, timeout=5); print(r.stdout.strip() or 'empty: '+r.stderr[:100])"`
      ).toString().trim();
    } catch (e) { pythonCanSpawnNode = 'ERR:' + e.message.slice(0, 150); }
    // Check native yt-dlp js engine integration exactly the way yt-dlp does it internally
    let ytDlpPythonNode = 'untested';
    try {
      ytDlpPythonNode = require('child_process').execSync(
        `python3 -c "from yt_dlp.utils._jsruntime import NodeJsRuntime; print(NodeJsRuntime()._info())"`
      ).toString().trim();
    } catch (e) { ytDlpPythonNode = 'ERR: ' + e.message.slice(0, 500); }

    res.json({
      nodeV,
      pythonV,
      ytDlpLoc,
      nodeLoc,
      pythonCanSpawnNode,
      ytDlpPythonNode,
      cwd: process.cwd(),
      cmd: YT_DLP_CMD,
      rapidApiSet: !!process.env.RAPID_API_KEY
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 All In One Downloader server running at http://0.0.0.0:${PORT}\n`);

  // Start the bgutil-server token provider locally in the background
  const potServerPath = path.join(__dirname, '../bgutil-server/build/main.js');
  if (fs.existsSync(potServerPath)) {
    console.log('[INFO] Starting bgutil-server Token Provider on port 4416...');
    const potProc = spawn(process.execPath, [potServerPath], {
      stdio: 'inherit',
      env: { ...process.env, PORT: '4416' }
    });
    potProc.on('error', (e) => console.error('[WARN] Failed to start Token Provider:', e.message));
    potProc.on('exit', (c) => console.warn(`[WARN] Token Provider exited with code ${c}`));
  } else {
    console.warn('[WARN] Token Provider server not found at:', potServerPath);
  }
});
