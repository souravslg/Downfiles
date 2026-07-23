// Disable TLS reject unauthorized
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function testSaveIg(url) {
  try {
    console.log("Fetching Instagram reel from SaveIg:", url);
    const res = await fetch('https://saveig.app/action.php?lang=en', {
      method: 'POST',
      headers: {
        'Accept': '*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://saveig.app',
        'Referer': 'https://saveig.app/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      body: 'url=' + encodeURIComponent(url) + '&action=post'
    });
    
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response text length:", text.length);

    const match = text.match(/eval\(function\(h,u,n,t,e,r\)\{.*?\}\((.*?)\)\)/);
    if (!match) {
      console.log("No eval match in SaveIg! Response start:", text.substring(0, 300));
      return;
    }
    console.log("Found eval match!");
  } catch (e) {
    console.error("SaveIg test failed:", e.message);
  }
}

testSaveIg("https://www.instagram.com/reel/C5y4B5_oxR5/");
