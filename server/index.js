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

  // Fallback for Localhost Testing
  const LOCAL_COOKIES_PATH = path.join(__dirname, '..', 'cookie_base.txt');
  if (fs.existsSync(LOCAL_COOKIES_PATH)) {
    const localTestCookies = fs.readFileSync(LOCAL_COOKIES_PATH, 'utf-8');
    if (localTestCookies.startsWith('# Netscape HTTP Cookie File')) {
      console.log('[INFO] Using local cookie_base.txt for authentication bypass');
      return ['--cookies', LOCAL_COOKIES_PATH];
    }
  }

  return [];
}

// --- Deleted proxy logic ---

function getYouTubeClient() {
  if (process.env.YOUTUBE_CLIENT) return process.env.YOUTUBE_CLIENT;

  const hasCookies = fs.existsSync(COOKIES_TMP_PATH) || fs.existsSync(path.join(__dirname, '..', 'cookie_base.txt'));
  // android_vr and tv are currently very resilient.
  // Use a comma-separated list to let yt-dlp pick the best available or rotate.
  return hasCookies ? 'web,tv,ios' : 'android_vr,tv,ios';
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

  if (isInstagram) {
    return ['--extractor-args', 'instagram:allow_direct_url=True'];
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

  const isSocial = url.includes('facebook.com') || url.includes('fb.com') ||
    url.includes('instagram.com') || url.includes('twitter.com') ||
    url.includes('tiktok.com');

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

  // Guarantee node's location is in PATH for yt-dlp to find the JS Challenge Provider
  const nodeDir = path.dirname(process.execPath);
  const pathEnv = [nodeDir, process.env.PATH].filter(Boolean).join(path.delimiter);

  const env = {
    ...process.env,
    ...(options.env || {}),
    PATH: pathEnv
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
    // Specific format selected by user — always add generous fallbacks
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

// --- Pytube helper ---
async function getPoToken() {
  try {
    const res = await fetch('http://127.0.0.1:4416/get_pot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (res.ok) {
      const data = await res.json();
      return { poToken: data.poToken, visitorData: data.contentBinding };
    }
  } catch (err) {
    console.warn('[WARN] Failed to fetch PO Token from provider:', err.message);
  }
  return null;
}

async function fetchPytubeInfo(url) {
  const pot = await getPoToken();
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const pyPath = path.join(__dirname, '..', 'pytube_helper.py');
    const args = ['info', url];
    if (pot) {
      // placeholders for itag and path
      args.push('none', 'none', pot.poToken, pot.visitorData);
    }
    const proc = spawn(pythonCmd, [pyPath, ...args]);
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(stderr || 'Pytube failed'));
      try {
        const info = JSON.parse(stdout);
        info.formats = (info.formats || []).map(f => ({ ...f, format_id: 'pytube_' + f.format_id }));
        resolve(info);
      } catch (e) { reject(e); }
    });
  });
}

// Cobalt fallback removed as per user request to use yt-dlp only.

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
    console.log('[INFO] Using pytubefix directly for YouTube...');
    try {
      const info = await fetchPytubeInfo(url);
      console.log('[INFO] pytubefix success');
      return res.json(info);
    } catch (pyErr) {
      console.error('[ERROR] pytubefix failed:', pyErr.message);
      return res.status(400).json({ error: 'YouTube fetch failed', details: pyErr.message });
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
      if (isYouTube) {
        console.log('[INFO] yt-dlp failed for YouTube, trying pytubefix...');
        try {
          const info = await fetchPytubeInfo(url);
          console.log('[INFO] pytubefix fallback successful');
          return res.json(info);
        } catch (pyErr) {
          console.error('[ERROR] pytubefix fallback failed:', pyErr.message);
        }
      } else {
        console.log('[INFO] yt-dlp failed and not a YouTube URL, no fallback available.');
      }

      let friendly = 'Could not fetch video info. Make sure the URL is valid and publicly accessible.';
      if (errOutput.includes('DRM protected')) {
        friendly = 'This video is DRM protected (Premium content) and cannot be downloaded.';
      } else if (errOutput.includes('Sign in') || errOutput.includes('private')) {
        friendly = 'This video is private or requires sign-in.';
      } else if (errOutput.includes('Requested format is not available')) {
        friendly = 'Could not fetch video info. Make sure the URL is valid and publicly accessible (Bot verification blocked).';
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

    const isYouTubeVideo = (info.extractor_key || '').toLowerCase().includes('youtube');

    const formats = (info.formats || []).filter(f => f.vcodec !== 'none' || f.acodec !== 'none')
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
  const isYouTube = url && (url.includes('youtube.com') || url.includes('youtu.be'));
  const isPytube = (format_id && format_id.startsWith('pytube_')) || isYouTube;

  if (isPytube) {
    const itag = format_id && format_id.startsWith('pytube_') ? format_id.replace('pytube_', '') : format_id;
    const pot = await getPoToken();
    const tmpId = uuidv4();
    const ext = isAudio ? 'mp3' : 'mp4';
    const tmpFile = path.join(os.tmpdir(), `pytube_${tmpId}.${ext}`);
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const pyPath = path.join(__dirname, '..', 'pytube_helper.py');

    console.log(`[DOWNLOAD] via pytubefix: itag=${itag}`);
    const args = ['download', url, itag || 'best', tmpFile];
    if (pot) {
      args.push(pot.poToken, pot.visitorData);
    }
    const proc = spawn(pythonCmd, [pyPath, ...args]);

    proc.stderr.on('data', d => console.log(`[pytube log] ${d}`));

    req.on('close', () => proc.kill());

    proc.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(tmpFile)) {
        if (!res.headersSent) res.status(500).send('Pytube download failed');
        return;
      }

      setDownloadFilename(res, title, ext);
      res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
      const stream = fs.createReadStream(tmpFile);
      stream.on('end', () => { try { fs.unlinkSync(tmpFile); } catch (e) { } });
      stream.pipe(res);
    });
    return;
  }

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
    ...getCookiesArgs()
  ];

  args.push('-o', tmpFile);

  if (isAudio) {
    args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
  }

  if (HAS_FFMPEG) {
    if (FFMPEG_PATH !== 'ffmpeg') {
      args.push('--ffmpeg-location', FFMPEG_PATH);
    }
    if (!isAudio) args.push('--merge-output-format', 'mp4');
  }

  args.push(url);

  console.log(`[DOWNLOAD] ${url}`);
  console.log(`  format: ${formatArg} | audio: ${isAudio} | ffmpeg: ${HAS_FFMPEG}`);
  console.log(`  tmp: ${tmpFile}`);

  let errOutput = '';
  let stdOutput = '';
  const proc = spawnYtDlp(args);

  proc.stderr.on('data', d => {
    errOutput += d.toString();
    process.stdout.write('[yt-dlp log] ' + d.toString());
  });
  proc.stdout.on('data', d => {
    stdOutput += d.toString();
  });

  req.on('close', () => proc.kill('SIGTERM'));

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
      let tmpFiles = fs.readdirSync(require('os').tmpdir()).filter(f => f.includes(`downfiles_${tmpId}`));
      if (tmpFiles.length > 0) {
        // Prioritize actual video containers over audio streams in case of unmerged files
        tmpFiles.sort((a, b) => {
          const score = f => f.endsWith('.mp4') ? 1 : f.endsWith('.mkv') ? 2 : f.endsWith('.webm') ? 3 : 4;
          return score(a) - score(b);
        });
        sendFile = require('path').join(require('os').tmpdir(), tmpFiles[0]);
      } else {
        if (!res.headersSent) {
          return res.status(500).json({
            error: 'Downloaded file not found on server.',
            tmpFileTried: tmpFile,
            ytdlpStderr: errOutput,
            ytdlpStdout: stdOutput
          });
        }
        return;
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

// POST /api/download-link - Get download link (for quality picker)
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
function startServer(port) {
  const server = app.listen(port, () => {
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

startServer(PORT);
