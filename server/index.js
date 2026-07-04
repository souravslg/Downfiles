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

// --- Tool77 configuration ---
const TOOL77_REQUEST_URL = 'https://www.tool77.com/en/v/download/all/request';

function decryptTool77Url(encryptedUrl) {
  if (!encryptedUrl) return '';
  try {
    const reversed = encryptedUrl.split('').reverse().join('');
    return Buffer.from(reversed, 'base64').toString('utf-8');
  } catch (err) {
    console.error('Decryption failed for URL:', encryptedUrl, err.message);
    return encryptedUrl;
  }
}

function normalizePayload(json) {
  if (!json || typeof json !== 'object') return null;
  
  let payload = (json.data !== null && typeof json.data === 'object') ? json.data : json;
  
  if (payload && payload.data && typeof payload.data === 'object' && !Array.isArray(payload.audios)) {
    if (Array.isArray(payload.data.audios) || Array.isArray(payload.data.normals) || payload.data.author !== undefined || payload.data.description !== undefined) {
      payload = payload.data;
    }
  }
  
  return payload;
}

async function fetchTool77Info(url) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Origin': 'https://www.tool77.com',
    'Referer': 'https://www.tool77.com/en/v/downloader'
  };

  try {
    const response = await fetch(TOOL77_REQUEST_URL, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ url })
    });

    const data = await response.json();
    if (data.code !== 'success' || !data.data) {
      throw new Error(data.message || 'Tool77 request failed');
    }

    const videoData = normalizePayload(data.data);
    if (!videoData) {
      throw new Error('Failed to normalize Tool77 data payload');
    }
    const formats = [];

    // 1. Process normals
    const normals = videoData.normals || [];
    normals.forEach((item, index) => {
      const decryptedUrl = decryptTool77Url(item.url);
      const formatId = `normal_${index}_${(item.name || 'quality').replace(/[^a-zA-Z0-9_-]/g, '')}`;
      formats.push({
        format_id: formatId,
        ext: (item.extension || 'mp4').toLowerCase(),
        resolution: item.name || 'unknown',
        filesize: item.contentLength || null,
        download_url: `/api/download?url=${encodeURIComponent(url)}&format_id=${encodeURIComponent(formatId)}`,
        decrypted_url: decryptedUrl,
        vcodec: 'mp4',
        acodec: 'aac',
        note: item.name || 'Normal Quality'
      });
    });

    // 2. Process videos
    const videos = videoData.videos || [];
    videos.forEach((item, index) => {
      const decryptedUrl = decryptTool77Url(item.url);
      const formatId = `video_${index}_${(item.name || 'quality').replace(/[^a-zA-Z0-9_-]/g, '')}`;
      formats.push({
        format_id: formatId,
        ext: (item.extension || 'mp4').toLowerCase(),
        resolution: item.name || 'unknown',
        filesize: item.contentLength || null,
        download_url: `/api/download?url=${encodeURIComponent(url)}&format_id=${encodeURIComponent(formatId)}`,
        decrypted_url: decryptedUrl,
        vcodec: 'mp4',
        acodec: 'aac',
        note: item.name || 'Video Quality'
      });
    });

    // 3. Process audios
    const audios = videoData.audios || [];
    audios.forEach((item, index) => {
      const decryptedUrl = decryptTool77Url(item.url);
      const formatId = `audio_${index}_${(item.name || 'quality').replace(/[^a-zA-Z0-9_-]/g, '')}`;
      formats.push({
        format_id: formatId,
        ext: (item.extension || 'mp3').toLowerCase(),
        resolution: 'audio',
        filesize: item.contentLength || null,
        download_url: `/api/download?url=${encodeURIComponent(url)}&format_id=${encodeURIComponent(formatId)}`,
        decrypted_url: decryptedUrl,
        vcodec: 'none',
        acodec: item.extension || 'mp3',
        note: item.name || 'Audio Quality'
      });
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
      title: videoData.title || 'Untitled',
      thumbnail: videoData.thumbnail || '',
      duration: 0,
      uploader: platform,
      platform: platform,
      webpage_url: url,
      formats: formats,
      best_format: formats.length > 0 ? formats[0].format_id : null
    };
  } catch (err) {
    console.error('[ERROR] Tool77 fetch failed:', err.message);
    throw err;
  }
}

// POST /api/info - Get video info
app.post('/api/info', async (req, res) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    console.log(`[INFO] Fetching via Tool77: ${url}`);
    const info = await fetchTool77Info(url);
    res.json(info);
  } catch (err) {
    console.error('[ERROR] Primary fetch failed:', err.message);
    res.status(400).json({ error: 'Failed to extract video info.', details: err.message });
  }
});

async function streamDownload(res, req, url, format_id, title) {
  try {
    console.log(`[DOWNLOAD] Fetching info for proxying (IP: server)...`, url);
    const vidInfo = await fetchTool77Info(url);

    const targetFormat = (vidInfo.formats || []).find(f => f.format_id === format_id) || vidInfo.formats[0];
    if (!targetFormat) throw new Error('Format not found');

    const downloadUrl = targetFormat.decrypted_url;
    console.log(`[DOWNLOAD] Fetching stream: ${downloadUrl}`);
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    };

    const mediaResponse = await fetch(downloadUrl, {
      method: 'GET',
      headers: headers,
      redirect: 'follow'
    });

    if (!mediaResponse.ok) {
       const bodyText = await mediaResponse.text();
       console.log(`[DOWNLOAD] Media URL failed (${mediaResponse.status}):`, bodyText.substring(0, 200));
       return res.status(mediaResponse.status).send('Media fetching failed: ' + bodyText);
    }

    const contentType = mediaResponse.headers.get('content-type') || '';

    // Set headers for file download
    const filename = `${title || 'video'}.${targetFormat.ext || 'mp4'}`.replace(/[^a-zA-Z0-9.-]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    
    const contentLength = mediaResponse.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    if (mediaResponse.body) {
      Readable.fromWeb(mediaResponse.body).pipe(res);
    } else {
      res.end();
    }

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
    console.log(`Server is running solely on Tool77 API!`);
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
