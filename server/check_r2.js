const fetch = global.fetch || require('node-fetch');

async function checkResource2() {
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  try {
      const parseRes = await fetch(`https://api.vidssave.com/api/contentsite_api/media/parse`, {
          method: 'POST',
          headers: { 
              'Content-Type': 'application/x-www-form-urlencoded',
              'Referer': `https://vidssave.com/`,
              'User-Agent': 'Mozilla/5.0'
          },
          body: `auth=20250901majwlqo&domain=api.vidssave.com&origin=source&link=${encodeURIComponent(url)}`
      });
      const data = await parseRes.json();
      if (data.status === 1) {
          const r2 = data.data.resources.find(r => r.quality === '360P');
          console.log("Resource 2 (360P):");
          console.log("  download_url:", r2.download_url);
          console.log("  resource_content:", r2.resource_content);
      }
  } catch(e) { console.log("Error:", e.message); }
}
checkResource2().catch(console.error);
