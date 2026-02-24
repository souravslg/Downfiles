const fs = require('fs');

async function testDebug() {
    const url = 'https://youtu.be/GX9x62kFsVU';
    console.log('Testing REMOTE /api/yt-debug...');
    try {
        const res = await fetch(`https://downfiles.up.railway.app/api/yt-debug?url=${encodeURIComponent(url)}&client=tv`);
        const data = await res.json();
        fs.writeFileSync('remote_debug.txt', data.stderr || '');
        console.log('Saved to remote_debug.txt');
    } catch (e) {
        console.error('Remote fetch failed:', e.message);
    }
}

testDebug();
