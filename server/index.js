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

// =====================================================================
// RUMIX-AI PROXY ROUTES
// Proxies requests to https://rumix-ai.vercel.app/api/social/*
// so the client never needs to leave your domain.
// =====================================================================
const RUMIX_BASE = 'https://rumix-ai.vercel.app/api/social';

async function rumixProxy(platform, req, res) {
  const { url, format = 'mp4' } = req.query;
  if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

  try {
    console.log(`[RUMIX] ${platform} → ${url}`);
    const apiRes = await fetch(
      `${RUMIX_BASE}/${platform}?url=${encodeURIComponent(url)}&format=${format}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': `https://rumix-ai.vercel.app/${platform}-downloader`,
          'Origin': 'https://rumix-ai.vercel.app'
        }
      }
    );
    const data = await apiRes.json();
    res.json(data);
  } catch (err) {
    console.error(`[RUMIX] ${platform} error:`, err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch from Rumix API' });
  }
}

// YouTube: returns { success, title, video_url, audio_url }
app.get('/api/rumix/youtube',   (req, res) => rumixProxy('youtube',   req, res));
// Instagram: returns { success, title, url }
app.get('/api/rumix/instagram', (req, res) => rumixProxy('instagram', req, res));
// Facebook: returns { success, title, video }
app.get('/api/rumix/facebook',  (req, res) => rumixProxy('facebook',  req, res));


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

function expandYoutubeUrl(url) {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === 'youtu.be' || parsedUrl.hostname.endsWith('.youtu.be')) {
      const videoId = parsedUrl.pathname.substring(1);
      if (videoId) {
        let expanded = `https://www.youtube.com/watch?v=${videoId}`;
        if (parsedUrl.search) {
          const searchParams = new URLSearchParams(parsedUrl.search);
          if (searchParams.has('t')) {
            expanded += `&t=${searchParams.get('t')}`;
          }
          if (searchParams.has('list')) {
            expanded += `&list=${searchParams.get('list')}`;
          }
        }
        return expanded;
      }
    }
  } catch (err) {}
  return url;
}

// --- SnapSave decryption and fetching for Facebook ---
const SNAPSAVE_DECRYPT_KEYS = ["","split","0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/","slice","indexOf","","",".","pow","reduce","reverse","0"];

function snapsaveBaseDecode(d, e, f) {
  var g = SNAPSAVE_DECRYPT_KEYS[2][SNAPSAVE_DECRYPT_KEYS[1]](SNAPSAVE_DECRYPT_KEYS[0]);
  var h = g[SNAPSAVE_DECRYPT_KEYS[3]](0, e);
  var i = g[SNAPSAVE_DECRYPT_KEYS[3]](0, f);
  var j = d[SNAPSAVE_DECRYPT_KEYS[1]](SNAPSAVE_DECRYPT_KEYS[0])[SNAPSAVE_DECRYPT_KEYS[10]]()[SNAPSAVE_DECRYPT_KEYS[9]](function(a, b, c) {
    if (h[SNAPSAVE_DECRYPT_KEYS[4]](b) !== -1)
      return a += h[SNAPSAVE_DECRYPT_KEYS[4]](b) * (Math[SNAPSAVE_DECRYPT_KEYS[8]](e, c));
  }, 0);
  var k = SNAPSAVE_DECRYPT_KEYS[0];
  while (j > 0) {
    k = i[j % f] + k;
    j = (j - (j % f)) / f;
  }
  return k || SNAPSAVE_DECRYPT_KEYS[11];
}

function decodeSnapSave(h, u, n, t, e, r) {
  let result = "";
  for (var i = 0, len = h.length; i < len; i++) {
    var s = "";
    while (h[i] !== n[e]) {
      s += h[i];
      i++;
    }
    for (var j = 0; j < n.length; j++) {
      s = s.replace(new RegExp(n[j], "g"), j);
    }
    result += String.fromCharCode(snapsaveBaseDecode(s, e, 10) - t);
  }
  return decodeURIComponent(escape(result));
}

async function fetchFacebookInfo(url) {
  try {
    const res = await fetch('https://snapsave.app/action.php?lang=en', {
      method: 'POST',
      headers: {
        'Accept': '*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://snapsave.app',
        'Referer': 'https://snapsave.app/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      body: new URLSearchParams({ url })
    });
    const text = await res.text();
    
    const match = text.match(/eval\(function\(h,u,n,t,e,r\)\{.*?\}\((.*?)\)\)/);
    if (!match) {
      throw new Error('Failed to find decryption scripts from Snapsave');
    }

    const rawArgs = match[1];
    const args = new Function(`return [${rawArgs}]`)();
    const unpacked = decodeSnapSave(...args);

    if (unpacked.includes('Error:')) {
      const errTextMatch = unpacked.match(/innerHTML\s*=\s*"([^"]+)"/) || unpacked.match(/Error:\s*([^"]+)/);
      const errMsg = errTextMatch ? errTextMatch[1].replace(/<[^>]*>/g, '') : 'Video is private or restricted.';
      throw new Error(errMsg);
    }

    const tbodyMatch = unpacked.match(/<tbody>([\s\S]*?)<\/tbody>/);
    if (!tbodyMatch) {
      throw new Error('No formats found in Snapsave response');
    }

    const tbodyHtml = tbodyMatch[1];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    const formats = [];

    while ((rowMatch = rowRegex.exec(tbodyHtml)) !== null) {
      const rowHtml = rowMatch[1];
      const tds = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      if (tds.length >= 3) {
        const quality = tds[0].replace(/<[^>]*>/g, '').trim();
        const hrefMatch = tds[2].match(/href=\\"(.*?)\\"|href='(.*?)'|href="(.*?)"/i);
        const downloadUrl = hrefMatch ? (hrefMatch[1] || hrefMatch[2] || hrefMatch[3]) : null;
        if (downloadUrl) {
          formats.push({
            format_id: `fb_${quality.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
            ext: 'mp4',
            resolution: quality,
            download_url: downloadUrl.replace(/\\/g, ''),
            decrypted_url: downloadUrl.replace(/\\/g, ''),
            vcodec: 'mp4',
            acodec: 'aac',
            note: `${quality} Quality`
          });
        }
      }
    }

    if (formats.length === 0) {
      throw new Error('Failed to parse download formats');
    }

    return {
      title: 'Facebook Video',
      thumbnail: '',
      duration: 0,
      uploader: 'Facebook',
      platform: 'Facebook',
      webpage_url: url,
      formats: formats,
      best_format: formats[0].format_id
    };
  } catch (err) {
    console.error('[ERROR] fetchFacebookInfo failed:', err.message);
    throw err;
  }
}

async function fetchTool77Info(url) {
  const targetUrl = expandYoutubeUrl(url);
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
      body: JSON.stringify({ url: targetUrl })
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
        download_url: decryptedUrl,
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
        download_url: decryptedUrl,
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
        download_url: decryptedUrl,
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

async function getVideoInfo(url) {
  const isFb = url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com');
  if (isFb) {
    return await fetchFacebookInfo(url);
  }
  return await fetchTool77Info(url);
}

// POST /api/info - Get video info
app.post('/api/info', async (req, res) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    console.log(`[INFO] Fetching info for: ${url}`);
    const info = await getVideoInfo(url);
    res.json(info);
  } catch (err) {
    console.error('[ERROR] Primary fetch failed:', err.message);
    res.status(400).json({ error: 'Failed to extract video info.', details: err.message });
  }
});

async function streamDownload(res, req, url, format_id, title, download_url, ext) {
  try {
    let downloadUrl = download_url;
    let fileExt = ext || 'mp4';

    if (!downloadUrl) {
      console.log(`[DOWNLOAD] Fetching info for proxying (IP: server)...`, url);
      const vidInfo = await getVideoInfo(url);
      const targetFormat = (vidInfo.formats || []).find(f => f.format_id === format_id) || vidInfo.formats[0];
      if (!targetFormat) throw new Error('Format not found');
      downloadUrl = targetFormat.decrypted_url;
      fileExt = targetFormat.ext || 'mp4';
    }

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
    const filename = `${title || 'video'}.${fileExt}`.replace(/[^a-zA-Z0-9.-]/g, '_');
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
  const { url, format_id, title, download_url, ext } = req.query;
  if (!url && !download_url) return res.status(400).send('URL or download_url is required');
  await streamDownload(res, req, url, format_id, title, download_url, ext);
});

// POST /api/download
app.post('/api/download', async (req, res) => {
  const { url, format_id, title, download_url, ext } = req.body;
  if (!url && !download_url) return res.status(400).json({ error: 'URL or download_url is required' });
  await streamDownload(res, req, url, format_id, title, download_url, ext);
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
