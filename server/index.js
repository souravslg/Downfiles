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
if (process.env.YOUTUBE_COOKIES) {
  try {
    const cookieString = Buffer.from(process.env.YOUTUBE_COOKIES, 'base64').toString('utf-8');
    fs.writeFileSync(COOKIES_TMP_PATH, cookieString, { encoding: 'utf-8' });
    console.log('[INFO] Loaded YouTube cookies from environment variable ✅ path:', COOKIES_TMP_PATH);
  } catch (err) {
    console.error('[ERROR] Failed to write YOUTUBE_COOKIES:', err.message);
  }
}

function getCookiesArgs() {
  if (fs.existsSync(COOKIES_TMP_PATH)) {
    return ['--cookies', COOKIES_TMP_PATH];
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
  return spawn(cmd, [...pre, ...args], options);
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
  const hasCookies = fs.existsSync(COOKIES_TMP_PATH);
  const playerClient = getYouTubeClient();
  const dbgArgs = [
    '--dump-json', '--no-playlist', '--no-warnings',
    '--impersonate', 'chrome',
    '--add-header', 'Accept-Language: en-US,en;q=0.9',
    '--extractor-args', 'youtube:player_client=' + playerClient,
    '--socket-timeout', '20',
    ...getCookiesArgs(),
    url
  ];
  let out = '', err = '';
  const p2 = spawnYtDlp(dbgArgs);
  p2.stdout.on('data', d => { out += d; });
  p2.stderr.on('data', d => { err += d; });
  p2.on('close', c => res.json({
    code: c, hasCookies, clientUsed: playerClient,
    cookiesTmpPath: COOKIES_TMP_PATH,
    cookiesRepoPath: COOKIES_REPO_PATH,
    repoFileExists: fs.existsSync(COOKIES_REPO_PATH),
    stderr: err.slice(0, 500), stdout_len: out.length
  }));
});

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
  const hasCookies = fs.existsSync(COOKIES_TMP_PATH);
  console.log(`[INFO] Cookies loaded: ${hasCookies}`);

  const args = [
    '--dump-json', '--no-playlist', '--no-warnings',
    '--add-header', 'Accept-Language: en-US,en;q=0.9',
    '--extractor-args', 'youtube:player_client=ios',
    '--socket-timeout', '30',
    ...getCookiesArgs(),
    url
  ];

  let output = '', errOutput = '';
  const proc = spawnYtDlp(args);
  proc.stdout.on('data', d => { output += d.toString(); });
  proc.stderr.on('data', d => { errOutput += d.toString(); process.stdout.write('[yt-dlp] ' + d); });
  proc.on('close', (code) => {
    console.log(`[INFO] yt-dlp exited with code ${code}`);
    if (code !== 0) {
      let friendly = 'Could not fetch video info. Make sure the URL is valid and publicly accessible.';
      if (errOutput.includes('DRM protected')) {
        friendly = 'This video is DRM protected (Premium content) and cannot be downloaded.';
      } else if (errOutput.includes('Sign in') || errOutput.includes('private')) {
        friendly = 'This video is private or requires sign-in.';
      } else if (errOutput.includes('Requested format is not available')) {
        friendly = 'Could not fetch video info. Make sure the URL is valid and publicly accessible.';
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

    const isYouTube = (info.extractor_key || '').toLowerCase().includes('youtube');

    const formats = (info.formats || [])
      .filter(f => f.vcodec !== 'none' || f.acodec !== 'none')
      .map(f => {
        const height = f.height || parseInt(f.resolution) || 0;
        // For YouTube: use height-based format selector (works on any server/client)
        // For other sites: use the actual format_id
        const safeFormatId = isYouTube && height
          ? `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`
          : f.format_id;
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
function streamDownload(res, req, url, format_id, isAudio, title) {
  const formatArg = buildFormatArg(format_id, isAudio);
  const ext = isAudio ? 'mp3' : 'mp4';
  const contentType = isAudio ? 'audio/mpeg' : 'video/mp4';

  const tmpId = uuidv4();
  const tmpFile = require('path').join(require('os').tmpdir(), `downfiles_${tmpId}.${ext}`);

  const args = [
    '-f', formatArg,
    '--no-playlist',
    '--extractor-args', 'youtube:player_client=ios',
    '--add-header', 'Accept-Language: en-US,en;q=0.9',
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

// GET /api/download?url=...&format_id=...&audio_only=1&title=...
app.get('/api/download', (req, res) => {
  const { url, format_id, audio_only, title } = req.query;
  if (!url) return res.status(400).send('URL is required');
  const isAudio = audio_only === '1' || audio_only === 'true';
  streamDownload(res, req, url, format_id, isAudio, title);
});

// POST /api/download - accepts JSON body as well
app.post('/api/download', (req, res) => {
  const url = req.body?.url;
  const format_id = req.body?.format_id;
  const audio_only = req.body?.audio_only;
  const title = req.body?.title;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  const isAudio = audio_only === '1' || audio_only === 'true' || audio_only === true;
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

app.listen(PORT, () => {
  console.log(`\n🚀 DownFiles server running at http://localhost:${PORT}\n`);
});
