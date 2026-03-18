const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8000;

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
  const args = [];
  let base64Cookies = (process.env.YOUTUBE_COOKIES || '').trim().replace(/^["']|["']$/g, '');
  if (!base64Cookies) {
    for (let i = 1; i <= 10; i++) {
      let chunk = process.env[`YOUTUBE_COOKIES_${i}`];
      if (chunk) {
        chunk = chunk.trim().replace(/^["']|["']$/g, '');
        if (chunk.startsWith('=')) chunk = chunk.substring(1);
        base64Cookies += chunk;
      } else {
        break;
      }
    }
  }

  if (base64Cookies) {
    try {
      const cookieString = Buffer.from(base64Cookies, 'base64').toString('utf-8');
      if (cookieString.trim().startsWith('# Netscape HTTP Cookie File')) {
        fs.writeFileSync(COOKIES_TMP_PATH, cookieString, { encoding: 'utf-8' });
        args.push('--cookies', COOKIES_TMP_PATH);
      } else {
        console.warn('[WARN] YOUTUBE_COOKIES is corrupted or not in Netscape format. Ignoring.');
      }
    } catch (err) {
      console.error('[ERROR] Failed to write YOUTUBE_COOKIES dynamically:', err.message);
    }
  } else if (fs.existsSync(COOKIES_TMP_PATH)) {
    const localCookies = fs.readFileSync(COOKIES_TMP_PATH, 'utf-8');
    if (localCookies.startsWith('# Netscape HTTP Cookie File')) {
      args.push('--cookies', COOKIES_TMP_PATH);
    }
  } else {
    // Fallback for Localhost Testing
    const LOCAL_COOKIES_PATH = path.join(__dirname, '..', 'cookie_base.txt');
    if (fs.existsSync(LOCAL_COOKIES_PATH)) {
      const localTestCookies = fs.readFileSync(LOCAL_COOKIES_PATH, 'utf-8');
      if (localTestCookies.startsWith('# Netscape HTTP Cookie File')) {
        console.log('[INFO] Using local cookie_base.txt for authentication bypass');
        args.push('--cookies', LOCAL_COOKIES_PATH);
      }
    }
  }

  // Also support Instagram specific cookies if they exist in env or locally
  let igBase64Cookies = (process.env.INSTAGRAM_COOKIES || '').trim().replace(/^["']|["']$/g, '');
  if (igBase64Cookies) {
    try {
      const igCookieString = Buffer.from(igBase64Cookies, 'base64').toString('utf-8');
      if (igCookieString.trim().startsWith('# Netscape HTTP Cookie File')) {
        const IG_COOKIES_TMP_PATH = path.join(os.tmpdir(), 'ig_cookies_tmp.txt');
        fs.writeFileSync(IG_COOKIES_TMP_PATH, igCookieString, { encoding: 'utf-8' });
        args.push('--cookies', IG_COOKIES_TMP_PATH);
      }
    } catch (err) {
      console.error('[ERROR] Failed to write INSTAGRAM_COOKIES dynamically:', err.message);
    }
  } else {
    const IG_LOCAL_COOKIES_PATH = path.join(__dirname, '..', 'ig_cookies.txt');
    if (fs.existsSync(IG_LOCAL_COOKIES_PATH)) {
      args.push('--cookies', IG_LOCAL_COOKIES_PATH);
    }
  }

  return args;
}

// --- Deleted proxy logic ---

function getYouTubeClient() {
  // No longer used for YouTube as we use vidssave.com instead
  return 'web,tv,ios';
}

// Returns extractor-args array only when a non-default client is set
function getExtractorArgs(url) {
  const isYouTube = url && (url.includes('youtube.com') || url.includes('youtu.be'));
  const isInstagram = url && url.includes('instagram.com');

  if (isYouTube) {
    const baseArgs = ['--js-runtimes', 'node'];
    const client = getYouTubeClient();
    if (!client || client === 'default') return baseArgs;
    return [...baseArgs, '--extractor-args', 'youtube:player_client=' + client];
  }

  if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com')) {
    // Facebook often needs more specific impersonation and extra arguments
    return ['--impersonate', 'chrome', '--no-check-certificate', '--geo-bypass'];
  }
  if (url.includes('instagram.com')) {
    // Instagram on datacenter IPs aggressively blocks Chrome impersonation without cookies. 
    // Safari impersonation with extra sleep sometimes bypasses the rate-limit blocks.
    return ['--impersonate', 'safari', '--no-check-certificate', '--sleep-requests', '1'];
  }

  return [];
}


// In-memory job store
const jobs = {};

// Find yt-dlp executable — tries yt-dlp → python -m yt_dlp → python3 -m yt_dlp
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

  const isSocial = url.includes('twitter.com') || url.includes('tiktok.com');

  if (isSocial) {
    // yt-dlp newer versions support --impersonate which is much more robust than just UA headers
    return ['--impersonate', 'chrome'];
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

  // Ensure process.env.PATH (with venv) is prioritized over system paths
  const nodeDir = path.dirname(process.execPath);
  const systemPaths = process.platform === 'win32' ? '' : '/usr/local/bin:/usr/bin:/bin';
  const pathEnv = [process.env.PATH, nodeDir, systemPaths].filter(Boolean).join(path.delimiter);

  if (options.debugPath) console.log(`[EXEC] PATH: ${pathEnv}`);

  const env = {
    ...process.env,
    ...(options.env || {}),
    PATH: pathEnv
  };

  return spawn(cmd, [...pre, ...args], { ...options, env });
}

// Build a safe format string depending on ffmpeg availability
function buildFormatArg(format_id, isAudio, isSocial) {
  if (isAudio) {
    return 'bestaudio[ext=m4a]/bestaudio';
  }

  // Treat generic fallback IDs from UI directly as 'auto'
  if (format_id === '(bestvideo+bestaudio)' || format_id === 'bestvideo+bestaudio' || format_id === 'best') {
    format_id = 'auto';
  }

  if (format_id && format_id !== 'auto') {
    // If the format_id natively includes audio or a merge request, use it as is
    if (format_id.includes('audio') || format_id.includes('+')) {
      return `${format_id}/best[acodec!=none]/best`;
    }

    if (HAS_FFMPEG) {
      // Force pairing with bestaudio if it's a social platform or DASH
      if (isSocial) {
        return `${format_id}+bestaudio/[ext=m4a]/${format_id}+bestaudio/best`;
      }
      return `${format_id}+bestaudio/${format_id}[acodec!=none]/bestvideo+bestaudio/best[acodec!=none]/best`;
    }
    return `${format_id}[acodec!=none]/best[acodec!=none]/best`;
  }

  if (HAS_FFMPEG) {
    // For social platforms (Instagram/Facebook): prefer pre-merged formats with audio first,
    // then fall back to bestvideo+bestaudio merge. This prevents silent video on Instagram
    // where yt-dlp may pick a video-only stream when split streams are listed first.
    if (isSocial) {
      return 'best[acodec!=none][ext=mp4]/best[acodec!=none]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
    }
    return 'bestvideo+bestaudio/best[acodec!=none]/best';
  }
  return 'best[acodec!=none]/best';
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

// --- Vidssave helper ---
const VIDSSAVE_AUTH = '20250901majwlqo';
const VIDSSAVE_DOMAIN = 'api-ak.vidssave.com';
const VIDSSAVE_PARSE_URL = 'https://api.vidssave.com/api/contentsite_api/media/parse';
const VIDSSAVE_REDIRECT_URL = 'https://api.vidssave.com/api/contentsite_api/media/download_redirect';

async function fetchVidssaveInfo(url) {
  try {
    const response = await fetch(VIDSSAVE_PARSE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://vidssave.com/',
        'Origin': 'https://vidssave.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: `auth=${VIDSSAVE_AUTH}&domain=${VIDSSAVE_DOMAIN}&origin=source&link=${encodeURIComponent(url)}`
    });

    let data;
    try {
      data = await response.json();
    } catch (e) {
      const text = await response.text().catch(() => '(no body)');
      console.error('[ERROR] Vidssave non-JSON response. Status:', response.status, 'Body:', text.slice(0, 300));
      throw new Error(`Vidssave returned non-JSON (HTTP ${response.status})`);
    }

    console.log('[INFO] Vidssave raw status:', data.status, '| message:', data.message);

    if (data.status !== 1 || !data.data) {
      throw new Error(data.message || 'Vidssave API failed');
    }

    const video = data.data;
    const formats = (video.resources || []).map(r => {
      let downloadUrl = r.download_url;
      if (!downloadUrl && r.resource_content) {
        downloadUrl = `${VIDSSAVE_REDIRECT_URL}?request=${encodeURIComponent(r.resource_content)}`;
      }

      return {
        format_id: r.resource_id,
        ext: (r.format || 'mp4').toLowerCase(),
        resolution: r.quality || (r.type === 'audio' ? 'audio' : '720p'),
        filesize: r.size || null,
        vcodec: r.type === 'video' ? 'h264' : 'none',
        acodec: r.type === 'audio' ? 'aac' : 'aac',
        download_url: downloadUrl // Pass this through to the backend for proxying
      };
    }).filter(f => f.download_url); // Only include formats with a valid download URL

    return {
      title: video.title,
      thumbnail: video.thumbnail,
      duration: parseInt(video.duration) || 0,
      uploader: 'YouTube',
      platform: 'YouTube (Vidssave)',
      webpage_url: url,
      formats: formats,
      best_format: formats.length > 0 ? formats[0].format_id : null
    };
  } catch (err) {
    console.error('[ERROR] Vidssave failed:', err.message);
    throw err;
  }
}

// POST /api/info - Get video info
app.post('/api/info', async (req, res) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // Strip YouTube playlist/mix params — only keep the video ID
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      const v = u.hostname.includes('youtu.be')
        ? u.pathname.replace('/', '')
        : u.searchParams.get('v');
      if (v) url = `https://www.youtube.com/watch?v=${v}`;
    }
  } catch { }

  console.log(`[INFO] Fetching: ${url}`);
  const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');

  if (isYouTube) {
    console.log('[INFO] Using Vidssave for YouTube...');
    try {
      const info = await fetchVidssaveInfo(url);
      console.log('[INFO] Vidssave success');
      return res.json(info);
    } catch (vidErr) {
      console.error('[ERROR] Vidssave failed:', vidErr.message);
      return res.status(400).json({ error: 'YouTube fetch failed via Vidssave. Please try again later.', details: vidErr.message });
    }
  }

  const hasCookies = fs.existsSync(COOKIES_TMP_PATH);
  console.log(`[INFO] Cookies loaded: ${hasCookies}`);

  const args = [
    '--dump-json',
    ...(isYouTube ? ['--no-playlist'] : []),
    '--no-warnings',
    ...getImpersonationArgs(url),
    '--add-header', 'Accept-Language: en-US,en;q=0.9',
    ...getExtractorArgs(url),
    '--rm-cache-dir',
    '--socket-timeout', '30',
    ...getCookiesArgs()
  ];

  args.push(url);

  let output = '', errOutput = '';
  const proc = spawnYtDlp(args);
  proc.stdout.on('data', d => { output += d.toString(); });
  proc.stderr.on('data', d => { errOutput += d.toString(); });


  proc.on('close', async (code) => {
    console.log(`[INFO] yt-dlp exited with code ${code}`);
    if (code !== 0) {
      let friendly = 'Could not fetch video info. Make sure the URL is valid and publicly accessible.';
      if (errOutput.includes('DRM protected')) {
        friendly = 'This video is DRM protected (Premium content) and cannot be downloaded.';
      } else if (errOutput.includes('Sign in') || errOutput.includes('private')) {
        friendly = 'This video is private or requires sign-in.';
      } else if (errOutput.includes('Requested format is not available') || errOutput.includes('rate-limit reached') || errOutput.includes('login required')) {
        friendly = 'Instagram/YouTube is currently blocking download attempts from this server. Please set up INSTAGRAM_COOKIES or YOUTUBE_COOKIES in the server environment variables to bypass this.';
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

    const formats = (info.formats || []).filter(f => f.vcodec !== 'none' || f.acodec !== 'none')
      .map(f => {
        const height = f.height || parseInt(f.resolution) || 0;
        return {
          format_id: f.format_id,
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
        const hA = parseInt(a.resolution) || 0;
        const hB = parseInt(b.resolution) || 0;
        if (hA !== hB) return hB - hA;
        const aCombined = a.vcodec !== 'none' && a.acodec !== 'none';
        const bCombined = b.vcodec !== 'none' && b.acodec !== 'none';
        if (aCombined && !bCombined) return -1;
        if (!aCombined && bCombined) return 1;
        return 0;
      });

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
  const isYouTube = url && (url.includes('youtube.com') || url.includes('youtu.be'));
  if (isYouTube) {
    try {
      console.log('[DOWNLOAD] Fetching via Vidssave...');
      const vidInfo = await fetchVidssaveInfo(url);
      const targetFormat = (vidInfo.formats || []).find(f => f.format_id === format_id) || vidInfo.formats[0];
      if (!targetFormat) throw new Error('Format not found for Vidssave');
      const downloadUrl = targetFormat.download_url;
      console.log(`[DOWNLOAD] Proxying Vidssave link: ${downloadUrl}`);
      const response = await fetch(downloadUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://vidssave.com/'
        }
      });
      if (!response.ok) throw new Error(`Vidssave download link failed: ${response.statusText}`);
      setDownloadFilename(res, title || vidInfo.title, targetFormat.ext);
      res.setHeader('Content-Type', targetFormat.ext === 'mp3' ? 'audio/mpeg' : 'video/mp4');
      const readable = response.body;
      readable.pipe(res);
      return;
    } catch (err) {
      console.error('[DOWNLOAD] Vidssave error:', err.message);
      if (!res.headersSent) res.status(500).send('Download failed: ' + err.message);
      return;
    }
  }

  const isFacebook = url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com');
  const isInstagram = url.includes('instagram.com');
  const isSocial = isFacebook || isInstagram;

  const formatArg = buildFormatArg(format_id, isAudio, isSocial);
  const impersonateArgs = getImpersonationArgs(url);
  const ext = isAudio ? 'mp3' : 'mp4';
  const contentType = isAudio ? 'audio/mpeg' : 'video/mp4';

  const tmpId = uuidv4();
  const tmpFile = path.join(os.tmpdir(), `downfiles_${tmpId}.${ext}`);
  const args = [
    '-f', formatArg,
    '--no-playlist',
    ...impersonateArgs,
    ...getExtractorArgs(url),
    '--add-header', 'Accept-Language: en-US,en;q=0.9',
    '--rm-cache-dir',
    '--socket-timeout', '60',
    '--no-warnings',
    ...getCookiesArgs()
  ];

  args.push('-o', tmpFile);
  if (isAudio) args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');

  if (HAS_FFMPEG) {
    if (FFMPEG_PATH !== 'ffmpeg') args.push('--ffmpeg-location', FFMPEG_PATH);
    if (!isAudio) {
      if (isSocial) args.push('--merge-output-format', 'mkv');
      else args.push('--merge-output-format', 'mp4');
    }
  }

  args.push(url);
  console.log(`[DOWNLOAD] ${url}`);
  let errOutput = '', stdOutput = '';
  const proc = spawnYtDlp(args);
  proc.stderr.on('data', d => { errOutput += d.toString(); });
  proc.stdout.on('data', d => { stdOutput += d.toString(); });
  req.on('close', () => proc.kill('SIGTERM'));

  proc.on('close', (code) => {
    console.log(`[DOWNLOAD] yt-dlp exited ${code}`);
    if (code !== 0) {
      if (!res.headersSent) res.status(500).send('Download failed: ' + errOutput.slice(0, 200));
      return;
    }
    let sendFile = null;
    let tmpFiles = fs.readdirSync(os.tmpdir()).filter(f => f.includes(`downfiles_${tmpId}`));
    if (tmpFiles.length > 0) {
      tmpFiles.sort((a, b) => {
        const score = f => f.endsWith('.mkv') ? 1 : f.endsWith('.webm') ? 2 : f.endsWith('.mp4') ? 3 : 4;
        return score(a) - score(b);
      });
      sendFile = path.join(os.tmpdir(), tmpFiles[0]);
    } else {
      if (!res.headersSent) return res.status(500).json({ error: 'Downloaded file not found on server.' });
      return;
    }
    const cleanup = (f) => { try { fs.unlinkSync(f); } catch { } };
    const actualExt = sendFile.split('.').pop() || ext;
    let actualContentType = contentType;
    if (actualExt === 'mkv') actualContentType = 'video/x-matroska';
    if (actualExt === 'webm') actualContentType = 'video/webm';
    setDownloadFilename(res, title, actualExt);
    res.setHeader('Content-Type', actualContentType);
    const stream = fs.createReadStream(sendFile);
    stream.on('end', () => cleanup(sendFile));
    stream.pipe(res);
  });
}

// GET /api/download?url=...&format_id=...&audio_only=1&title=...
app.get('/api/download', async (req, res) => {
  const { url, format_id, audio_only, title } = req.query;
  if (!url) return res.status(400).send('URL is required');
  const isAudio = audio_only === '1' || audio_only === 'true';
  await streamDownload(res, req, url, format_id, isAudio, title);
});

// POST /api/download - accepts JSON body as well
app.post('/api/download', async (req, res) => {
  const url = req.body?.url;
  const format_id = req.body?.format_id;
  const audio_only = req.body?.audio_only;
  const title = req.body?.title;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  const isAudio = audio_only === '1' || audio_only === 'true' || audio_only === true;
  await streamDownload(res, req, url, format_id, isAudio, title);
});

// POST /api/download-link - Get download link
app.post('/api/download-link', (req, res) => {
  const { url, format_id, audio_only } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  const directUrl = `${req.protocol}://${req.get('host')}/api/download?url=${encodeURIComponent(url)}` +
    (format_id ? `&format_id=${encodeURIComponent(format_id)}` : '') +
    (audio_only ? `&audio_only=1` : '');
  res.json({ download_url: directUrl });
});

// GET /api/stream/:jobId - Stream by job
app.get('/api/stream/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const { url, format_id, audio_only } = job;
  let formatArg = audio_only ? 'bestaudio[ext=m4a]/bestaudio' :
    (format_id && format_id !== 'auto' ? `${format_id}+bestaudio[ext=m4a]/${format_id}+bestaudio/best` :
      'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
  const ext = audio_only ? 'mp3' : 'mp4';
  res.setHeader('Content-Disposition', `attachment; filename="download.${ext}"`);
  res.setHeader('Content-Type', audio_only ? 'audio/mpeg' : 'video/mp4');
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

function startServer(port) {
  app.listen(port, () => {
    console.log(`\n🚀 All In One Downloader server running at http://localhost:${port}\n`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}


module.exports = app;

if (require.main === module) {
  startServer(PORT);
}
