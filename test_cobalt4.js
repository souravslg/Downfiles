async function testCobalt() {
    const url = 'https://youtu.be/GX9x62kFsVU';
    console.log('Testing cobalt.tools backend with youtu.be link...');
    try {
        const resp = await fetch('https://api.cobalt.tools/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Origin': 'https://cobalt.tools',
                'Referer': 'https://cobalt.tools/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            body: JSON.stringify({
                url,
                downloadMode: 'auto',
                videoQuality: 'max',
                filenameStyle: 'basic',
            }),
        });
        console.log('Status Cobalt:', resp.status);
        const text = await resp.text();
        console.log(text);
    } catch (e) {
        console.error('Fetch failed:', e.message);
    }
}

testCobalt();
