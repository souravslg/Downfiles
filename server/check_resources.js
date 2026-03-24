const fetch = global.fetch || require('node-fetch');

async function checkResources() {
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
          data.data.resources.forEach((r, i) => {
              console.log(`Resource ${i}: Quality=${r.quality}, ID=${r.resource_id}, Type=${r.type}`);
              console.log(`  download_url: ${r.download_url ? 'exists' : 'null'}`);
              console.log(`  resource_content Start: ${r.resource_content?.substring(0, 30)}`);
          });
      }
  } catch(e) { console.log("Error:", e.message); }
}
checkResources().catch(console.error);
