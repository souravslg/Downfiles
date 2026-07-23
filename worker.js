const TOOL77_REQUEST_URL = 'https://www.tool77.com/en/v/download/all/request';

// --- Tool77 decryption ---
function decryptTool77Url(encryptedUrl) {
  if (!encryptedUrl) return '';
  try {
    const reversed = encryptedUrl.split('').reverse().join('');
    return atob(reversed);
  } catch (err) {
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
          if (searchParams.has('t')) expanded += `&t=${searchParams.get('t')}`;
          if (searchParams.has('list')) expanded += `&list=${searchParams.get('list')}`;
        }
        return expanded;
      }
    }
  } catch (err) {}
  return url;
}

// --- SnapSave decryption ---
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
  if (!match) throw new Error('Failed to find decryption scripts from Snapsave');

  const rawArgs = match[1];
  const args = new Function(`return [${rawArgs}]`)();
  const unpacked = decodeSnapSave(...args);

  if (unpacked.includes('Error:')) {
    const errTextMatch = unpacked.match(/innerHTML\s*=\s*"([^"]+)"/) || unpacked.match(/Error:\s*([^"]+)/);
    const errMsg = errTextMatch ? errTextMatch[1].replace(/<[^>]*>/g, '') : 'Video is private or restricted.';
    throw new Error(errMsg);
  }

  const tbodyMatch = unpacked.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) throw new Error('No formats found in Snapsave response');

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

  if (formats.length === 0) throw new Error('Failed to parse download formats');

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

  const response = await fetch(TOOL77_REQUEST_URL, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ url: targetUrl })
  });

  const data = await response.json();
  if (data.code !== 'success' || !data.data) throw new Error(data.message || 'Request failed');

  const videoData = normalizePayload(data.data);
  if (!videoData) throw new Error('Failed to parse downloader engine payload');
  const formats = [];

  // normals
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

  // videos
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

  // audios
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
  } catch {}

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
}

async function getVideoInfo(url) {
  const isFb = url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com');
  if (isFb) return await fetchFacebookInfo(url);
  return await fetchTool77Info(url);
}

// Handler for /api/info
async function handleInfo(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  try {
    const body = await request.json();
    const { url } = body;
    if (!url) {
      return new Response(JSON.stringify({ error: 'URL is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    const info = await getVideoInfo(url);
    return new Response(JSON.stringify(info), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to extract video info.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// Handler for /api/download
async function handleDownload(request) {
  const parsedUrl = new URL(request.url);
  const url = parsedUrl.searchParams.get('url');
  const format_id = parsedUrl.searchParams.get('format_id');
  const title = parsedUrl.searchParams.get('title') || 'download';
  let ext = parsedUrl.searchParams.get('ext') || 'mp4';

  if (!url) {
    return new Response('URL parameter is required', { status: 400 });
  }

  try {
    const vidInfo = await getVideoInfo(url);
    const targetFormat = (vidInfo.formats || []).find(f => f.format_id === format_id) || vidInfo.formats[0];
    if (!targetFormat) {
      return new Response('Format not found', { status: 404 });
    }

    const downloadUrl = targetFormat.decrypted_url;
    const fileExt = targetFormat.ext || ext;

    const mediaResponse = await fetch(downloadUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });

    if (!mediaResponse.ok) {
      return new Response('Failed to fetch media file', { status: mediaResponse.status });
    }

    const filename = `${title}.${fileExt}`.replace(/[^a-zA-Z0-9.-]/g, '_');
    const newHeaders = new Headers(mediaResponse.headers);
    newHeaders.set('Content-Disposition', `attachment; filename="${filename}"`);
    newHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(mediaResponse.body, {
      status: mediaResponse.status,
      statusText: mediaResponse.statusText,
      headers: newHeaders
    });
  } catch (err) {
    return new Response(`Download proxy error: ${err.message}`, { status: 500 });
  }
}

// Cloudflare Workers fetch entrypoint
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle CORS preflight options request
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // Route API requests
    if (url.pathname === '/api/info') {
      return handleInfo(request);
    }
    if (url.pathname === '/api/download') {
      return handleDownload(request);
    }

    // Fall back to serving static assets (HTML, CSS, JS) from Cloudflare Assets
    return env.ASSETS.fetch(request);
  }
};
