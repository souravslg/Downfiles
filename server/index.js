const express = require('express');
const cors = require('cors');
const path = require('path');

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

// --- Vidssave helper ---
const VIDSSAVE_AUTH = '20250901majwlqo';
const VIDSSAVE_DOMAIN = 'api-ak.vidssave.com';
const VIDSSAVE_PARSE_URL = 'https://api.vidssave.com/api/contentsite_api/media/parse';
const VIDSSAVE_REDIRECT_URL = 'https://api.vidssave.com/api/contentsite_api/media/download_redirect';

function generateRandomIp() {
  const blocks = [
    [104, Math.floor(Math.random() * 128), Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)],
    [98, Math.floor(Math.random() * 255), Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)],
    [76, Math.floor(Math.random() * 255), Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)]
  ];
  const block = blocks[Math.floor(Math.random() * blocks.length)];
  return block.join('.');
}

async function fetchVidssaveInfo(url) {
  const fakeIp = generateRandomIp();

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
        'X-Requested-With': 'XMLHttpRequest',
        'X-Forwarded-For': fakeIp,
        'Client-IP': fakeIp
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
      const errorStr = data.message || JSON.stringify(data);
      throw new Error(`Vidssave Error (Status: ${data.status}): ${errorStr}`);
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
        download_url: downloadUrl
      };
    }).filter(f => f.download_url);

    return {
      title: video.title,
      thumbnail: video.thumbnail,
      duration: parseInt(video.duration) || 0,
      uploader: video.source || 'VidsSave',
      platform: 'VidsSave API',
      webpage_url: url,
      formats: formats,
      best_format: formats.length > 0 ? formats[0].format_id : null
    };
  } catch (err) {
    console.error('[ERROR] Vidssave failed:', err.message);
    throw err;
  }
}

// POST /api/info - Get video info for ALL links purely through VidsSave
app.post('/api/info', async (req, res) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // Strip YouTube playlist/mix params — only keep the video ID, but keep other URLs intact
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      const v = u.hostname.includes('youtu.be')
        ? u.pathname.replace('/', '')
        : u.searchParams.get('v');
      if (v) url = `https://www.youtube.com/watch?v=${v}`;
    }
  } catch { }

  console.log(`[INFO] Fetching via VidsSave: ${url}`);

  try {
    const info = await fetchVidssaveInfo(url);
    return res.json(info);
  } catch (err) {
    console.error('[ERROR] Info extraction failed:', err.message);
    return res.status(400).json({ error: 'Failed to extract video info. Please check the URL or try again later.', details: err.message });
  }
});

// Stream from VidsSave link to client
async function streamDownload(res, req, url, format_id, title) {
  try {
    console.log('[DOWNLOAD] Fetching via Vidssave...', url);
    const vidInfo = await fetchVidssaveInfo(url);
    const targetFormat = (vidInfo.formats || []).find(f => f.format_id === format_id) || vidInfo.formats[0];

    if (!targetFormat) throw new Error('Format not found for Vidssave');

    const downloadUrl = targetFormat.download_url;
    console.log(`[DOWNLOAD] Proxying Vidssave link: ${downloadUrl}`);

    const response = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://vidssave.com/'
      }
    });

    if (!response.ok) throw new Error(`Vidssave download link failed: ${response.statusText}`);

    const safeTitle = (title || vidInfo.title || 'downfiles')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80);

    const ext = targetFormat.ext;
    const ascii = `${safeTitle}.${ext}`;
    const encoded = encodeURIComponent(safeTitle) + '.' + ext;

    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`);
    res.setHeader('Content-Type', ext === 'mp3' ? 'audio/mpeg' : 'video/mp4');

    // Pipe the VidsSave server response directly to the client
    const readable = response.body;
    readable.pipe(res);
  } catch (err) {
    console.error('[DOWNLOAD] error:', err.message);
    if (!res.headersSent) res.status(500).send('Download failed: ' + err.message);
  }
}

// GET /api/download
app.get('/api/download', async (req, res) => {
  const { url, format_id, title } = req.query;
  if (!url) return res.status(400).send('URL is required');
  await streamDownload(res, req, url, format_id, title);
});

// POST /api/download
app.post('/api/download', async (req, res) => {
  const { url, format_id, title } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  await streamDownload(res, req, url, format_id, title);
});

// POST /api/download-link - Get download link
app.post('/api/download-link', (req, res) => {
  const { url, format_id } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  const directUrl = `${req.protocol}://${req.get('host')}/api/download?url=${encodeURIComponent(url)}` +
    (format_id ? `&format_id=${encodeURIComponent(format_id)}` : '');
  res.json({ url: directUrl });
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running solely on VidsSave API!`);
    console.log(`Local UI available at: http://localhost:${PORT}`);
    console.log(`API info endpoint available at: http://localhost:${PORT}/api/info`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${PORT} is in use, trying ${PORT + 1}...`);
      process.env.PORT = PORT + 1;
      app.listen(PORT + 1, '0.0.0.0');
    } else {
      console.error('Server error:', err);
    }
  });
}
