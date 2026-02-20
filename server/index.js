const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

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

// In-memory job store
const jobs = {};

// Find yt-dlp executable — Windows fallback
const { execSync } = require('child_process');
let YT_DLP_CMD = 'yt-dlp';
try {
  execSync('yt-dlp --version', { stdio: 'ignore' });
} catch {
  try {
    execSync('python -m yt_dlp --version', { stdio: 'ignore' });
    YT_DLP_CMD = 'python -m yt_dlp';
  } catch {
    console.warn('WARNING: yt-dlp not found. Install it with: pip install yt-dlp');
  }
}
console.log(`Using yt-dlp command: ${YT_DLP_CMD}`);

// Check for ffmpeg (needed to merge video+audio streams for 1080p+)
const FFMPEG_LOCAL = path.join(__dirname, 'ffmpeg.exe');
let HAS_FFMPEG = false;
let FFMPEG_PATH = null;

// Check local ./server/ffmpeg.exe first, then system PATH
const fs = require('fs');
if (fs.existsSync(FFMPEG_LOCAL)) {
  HAS_FFMPEG = true;
  FFMPEG_PATH = FFMPEG_LOCAL;
  console.log(`ffmpeg found locally at ${FFMPEG_LOCAL} — 1080p+ HD downloads enabled ✅`);
} else {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    HAS_FFMPEG = true;
    FFMPEG_PATH = 'ffmpeg';
    console.log('ffmpeg found in system PATH — 1080p+ HD downloads enabled ✅');
  } catch {
    console.warn('ffmpeg NOT found — downloads will use pre-merged streams (720p max).');
  }
}

function getYtDlpCmd() {
  return YT_DLP_CMD;
}

// Build a safe format string depending on ffmpeg availability
function buildFormatArg(format_id, isAudio) {
  if (isAudio) {
    // Audio: always works, no merging needed
    return 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio';
  }
  if (format_id && format_id !== 'auto') {
    // Specific format selected by user
    if (HAS_FFMPEG) {
      return `${format_id}+bestaudio[ext=m4a]/${format_id}+bestaudio/${format_id}`;
    }
    return format_id;
  }
  // Auto mode
  if (HAS_FFMPEG) {
    // Prefer mp4 container with merged streams
    return 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best';
  }
  // No ffmpeg — use pre-merged mp4 streams only (avoids webm)
  return 'best[ext=mp4]/best[height<=720]/best';
}

// Safe filename sanitiser
function safeFilename(title, ext) {
  const name = (title || 'downfiles')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return `${name}.${ext}`;
}

// POST /api/info - Get video info
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const args = [
    '--dump-json',
    '--no-playlist',
    '--socket-timeout', '30',
    url
  ];

  let output = '';
  let errOutput = '';

  const proc = spawn(getYtDlpCmd(), args, { shell: true });

  proc.stdout.on('data', (data) => { output += data.toString(); });
  proc.stderr.on('data', (data) => { errOutput += data.toString(); });

  proc.on('close', (code) => {
    if (code !== 0) {
      return res.status(400).json({ error: 'Could not fetch video info. Make sure the URL is valid.', details: errOutput });
    }
    try {
      const info = JSON.parse(output);
      const formats = (info.formats || [])
        .filter(f => f.vcodec !== 'none' || f.acodec !== 'none')
        .map(f => ({
          format_id: f.format_id,
          ext: f.ext,
          resolution: f.resolution || (f.height ? `${f.height}p` : 'audio'),
          filesize: f.filesize || f.filesize_approx || null,
          vcodec: f.vcodec,
          acodec: f.acodec,
          fps: f.fps || null,
          tbr: f.tbr || null,
          note: f.format_note || ''
        }))
        .sort((a, b) => {
          const getH = r => parseInt(r) || 0;
          return getH(b.resolution) - getH(a.resolution);
        });

      // Deduplicate by resolution
      const seen = new Set();
      const uniqueFormats = formats.filter(f => {
        const key = f.resolution + f.ext;
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
    } catch (e) {
      res.status(500).json({ error: 'Failed to parse video info' });
    }
  });
});

// Helper to stream a download response
function streamDownload(res, req, url, format_id, isAudio, title) {
  const formatArg = buildFormatArg(format_id, isAudio);
  const ext = isAudio ? 'mp3' : 'mp4';
  const contentType = isAudio ? 'audio/mpeg' : 'video/mp4';
  const filename = safeFilename(title, ext);

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');

  const args = [
    '-f', formatArg,
    '--no-playlist',
    '--socket-timeout', '60',
    '-o', '-'
  ];

  if (isAudio) {
    args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
  }

  if (HAS_FFMPEG) {
    args.push('--ffmpeg-location', FFMPEG_PATH);
    args.push('--merge-output-format', 'mp4');
  }

  args.push(url);

  console.log(`[DOWNLOAD] ${url}`);
  console.log(`  format: ${formatArg} | audio: ${isAudio} | ffmpeg: ${HAS_FFMPEG}`);

  const proc = spawn(getYtDlpCmd(), args, { shell: true });
  proc.stdout.pipe(res);
  proc.stderr.on('data', d => process.stdout.write('[yt-dlp] ' + d.toString()));
  proc.on('close', code => console.log(`[DOWNLOAD] done (code ${code})`));
  req.on('close', () => proc.kill('SIGTERM'));
  res.on('finish', () => proc.kill('SIGTERM'));
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
  const proc = spawn(getYtDlpCmd(), args, { shell: true });
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
