async function testDebug() {
    const clients = ['android', 'ios', 'tv', 'web', 'default'];
    for (const c of clients) {
        console.log(`Testing client=${c}...`);
        try {
            const res = await fetch(`https://downfiles.up.railway.app/api/yt-debug?url=https://youtu.be/GX9x62kFsVU&client=${c}`);
            const data = await res.json();
            console.log(`[${c}] Exit code: ${data.code}`);
            const lines = data.stderr.split('\n');
            const errLine = lines.find(l => l.includes('ERROR:'));
            console.log(`[${c}] Error: ${errLine || 'None'}`);
        } catch (e) {
            console.error(e.message);
        }
    }
}

testDebug();
