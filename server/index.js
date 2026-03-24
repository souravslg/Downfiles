const express = require('express');
const cors = require('cors');
const path = require('path');
const { Readable } = require('stream');

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

// --- Vidssave configuration ---
const VIDSSAVE_AUTH = '20250901majwlqo';
const VIDSSAVE_DOMAIN = 'api.vidssave.com';
const VIDSSAVE_PARSE_URL = 'https://api.vidssave.com/api/contentsite_api/media/parse';
const VIDSSAVE_REDIRECT_URL = 'https://api.vidssave.com/api/contentsite_api/media/download_redirect';

function generateRandomIp() {
  const blocks = [
    [104, Math.floor(Math.random() * 128), Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)],
    [98, Math.floor(Math.random() * 255), Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)],
    [76, Math.floor(Math.random() * 255), Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)]
  ];
  return blocks[Math.floor(Math.random() * blocks.length)].join('.');
}

async function fetchVidssaveInfo(url, clientIp) {
  const ipToUse = clientIp || generateRandomIp();
  try {
    const response = await fetch(VIDSSAVE_PARSE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://vidssave.com/',
        'Origin': 'https://vidssave.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'X-Forwarded-For': ipToUse,
        'Client-IP': ipToUse
      },
      body: `auth=${VIDSSAVE_AUTH}&domain=${VIDSSAVE_DOMAIN}&origin=source&link=${encodeURIComponent(url)}`
    });

    const data = await response.json();
    if (data.status !== 1 || !data.data) {
      throw new Error(data.message || 'Vidssave parse failed');
    }

    const video = data.data;
    const formats = (video.resources || []).map(r => {
      // The redirect token is in resource_content.
      const redirectUrl = `${VIDSSAVE_REDIRECT_URL}?request=${encodeURIComponent(r.resource_content || r.download_url)}&auth=${VIDSSAVE_AUTH}&domain=${VIDSSAVE_DOMAIN}`;
      
      return {
        format_id: r.resource_id,
        ext: (r.format || 'mp4').toLowerCase(),
        resolution: r.quality || '720p',
        filesize: r.size || null,
        download_url: redirectUrl
      };
    });

    let platform = 'Social Media';
    try {
      const u = new URL(url);
      if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) platform = 'YouTube';
      else if (u.hostname.includes('instagram.com')) platform = 'Instagram';
      else if (u.hostname.includes('facebook.com') || u.hostname.includes('fb.watch')) platform = 'Facebook';
      else if (u.hostname.includes('tiktok.com')) platform = 'TikTok';
      else if (u.hostname.includes('vimeo.com')) platform = 'Vimeo';
      else if (u.hostname.includes('twitter.com') || u.hostname.includes('x.com')) platform = 'X (Twitter)';
    } catch { }

    return {
      title: video.title,
      thumbnail: video.thumbnail,
      duration: parseInt(video.duration) || 0,
      uploader: video.source || platform,
      platform: platform,
      webpage_url: url,
      formats: formats,
      best_format: formats.length > 0 ? formats[0].format_id : null
    };
  } catch (err) {
    console.error('[ERROR] Vidssave fetch failed:', err.message);
    throw err;
  }
}

// POST /api/info - Get video info
app.post('/api/info', async (req, res) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    console.log(`[INFO] Fetching via VidsSave: ${url}`);
    const info = await fetchVidssaveInfo(url);
    res.json(info);
  } catch (err) {
    console.error('[ERROR] Primary fetch failed:', err.message);
    res.status(400).json({ error: 'Failed to extract video info.', details: err.message });
  }
});

async function streamDownload(res, req, url, format_id, title) {
  try {
    console.log('[DOWNLOAD] Fetching info for redirect...', url);
    const vidInfo = await fetchVidssaveInfo(url);

    const targetFormat = (vidInfo.formats || []).find(f => f.format_id === format_id) || vidInfo.formats[0];
    if (!targetFormat) throw new Error('Format not found');

    const downloadUrl = targetFormat.download_url;
    console.log(`[DOWNLOAD] Quality: ${targetFormat.resolution}, Redirecting to: ${downloadUrl}`);
    return res.redirect(downloadUrl);
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
