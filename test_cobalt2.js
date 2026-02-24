async function testCobalt() {
    const url = 'https://youtu.be/GX9x62kFsVU?list=RDzlcs_1knJSA';
    console.log('Testing cobalt.tools backend with youtu.be link...');
    try {
        const resp = await fetch('https://co.wuk.sh/api/json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
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
