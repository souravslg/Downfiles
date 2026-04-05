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
const VIDSSAVE_DOMAIN = 'api-ak.vidssave.com';
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
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer': 'https://vidssave.com/',
    'Origin': 'https://vidssave.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  };

  // Only use IP spoofing headers if we have a client IP from the frontend.
  // When 'clientIp' is null (server-side proxying), we don't send these so VidsSave
  // sees the server's actual IP consistently across parse and redirect calls.
  if (clientIp) {
    headers['X-Forwarded-For'] = clientIp;
    headers['Client-IP'] = clientIp;
  }

  try {
    const response = await fetch(VIDSSAVE_PARSE_URL, {
      method: 'POST',
      headers: headers,
      body: `auth=${VIDSSAVE_AUTH}&domain=${VIDSSAVE_DOMAIN}&origin=source&link=${encodeURIComponent(url)}`
    });


    const data = await response.json();
    if (data.status !== 1 || !data.data) {
      throw new Error(data.message || 'Vidssave parse failed');
    }

    const video = data.data;
    const resources = video.resources || [];
    
    const formats = resources.map(r => {
      // For YouTube, sometimes it provides a direct download_url (e.g. googlevideo.com)
      // or a resource_content token. We should prioritize the token for the redirect.
      const requestToken = r.resource_content || r.download_url;
      const redirectUrl = `${VIDSSAVE_REDIRECT_URL}?request=${encodeURIComponent(requestToken)}`;
      
      const vcodec = r.type === 'video' ? 'mp4' : (r.type === 'audio' ? 'none' : 'unknown');
      const acodec = r.type === 'audio' ? 'mp3' : (r.type === 'video' ? 'aac' : 'unknown');

      return {
        format_id: r.resource_id || Math.random().toString(36).substring(7),
        ext: (r.format || 'mp4').toLowerCase(),
        resolution: r.quality || 'unknown',
        filesize: r.size || null,
        download_url: redirectUrl,
        vcodec: vcodec,
        acodec: acodec,
        note: r.quality
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
      title: video.title || 'Untitled',
      thumbnail: video.thumbnail || '',
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

  // Get client IP for Vidssave (essential for valid redirect tokens)
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;

  try {
    console.log(`[INFO] Fetching via VidsSave: ${url} (Client IP: ${clientIp})`);
    const info = await fetchVidssaveInfo(url, clientIp);
    res.json(info);
  } catch (err) {
    console.error('[ERROR] Primary fetch failed:', err.message);
    res.status(400).json({ error: 'Failed to extract video info.', details: err.message });
  }
});

async function streamDownload(res, req, url, format_id, title) {
  try {
    // When proxying the full stream, we must use the server's own IP for the parse
    // to ensure we can get the redirect correctly from where we are (the server).
    console.log(`[DOWNLOAD] Fetching info for proxying (IP: server)...`, url);
    const vidInfo = await fetchVidssaveInfo(url, null);

    const targetFormat = (vidInfo.formats || []).find(f => f.format_id === format_id) || vidInfo.formats[0];
    if (!targetFormat) throw new Error('Format not found');

    const downloadUrl = targetFormat.download_url;
    console.log(`[DOWNLOAD] Fetching redirect: ${downloadUrl}`);
    
    // Get the final media location
    const redirectResponse = await fetch(downloadUrl, {
      method: 'GET',
      headers: {
        'Referer': 'https://vidssave.com/',
        'Origin': 'https://vidssave.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      redirect: 'follow' // We follow all redirects to get the actual media stream
    });

    if (!redirectResponse.ok) {
       const bodyText = await redirectResponse.text();
       console.log(`[DOWNLOAD] Final URL failed (${redirectResponse.status}):`, bodyText.substring(0, 200));
       return res.status(redirectResponse.status).send('Media fetching failed: ' + bodyText);
    }

    const finalUrl = redirectResponse.url;
    console.log(`[DOWNLOAD] Final Media URL: ${finalUrl}`);

    // Read the first chunk to check if it's a small JSON error like "link is empty"
    // VidsSave sometimes returns status 200 with an error JSON body.
    const bodyClone = redirectResponse.body;
    const reader = bodyClone.getReader();
    const { done, value } = await reader.read();
    
    if (!done && value.length < 500) {
       const text = new TextDecoder().decode(value);
       if (text.includes('"status":0') || text.includes('link is empty')) {
          console.log(`[DOWNLOAD] VidsSave JSON Error detected:`, text);
          return res.status(400).send('Download link expired. Please refresh page and try again.');
       }
    }

    // Set headers for file download
    const filename = `${title || 'video'}.${targetFormat.ext || 'mp4'}`.replace(/[^a-zA-Z0-9.-]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', redirectResponse.headers.get('content-type') || 'application/octet-stream');
    
    const contentLength = redirectResponse.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    // Pipe the remaining data (including the first chunk we read)
    if (value) res.write(value);
    
    async function pipeRemaining() {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(value)) {
          await new Promise(resolve => res.once('drain', resolve));
        }
      }
      res.end();
    }
    
    pipeRemaining().catch(err => {
      console.error('[DOWNLOAD] Pipe failed:', err.message);
      if (!res.headersSent) res.end();
    });


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
