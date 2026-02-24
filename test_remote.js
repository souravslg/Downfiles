const fs = require('fs');

async function testRemote() {
    const url = 'https://youtu.be/GX9x62kFsVU?list=RDzlcs_1knJSA';
    console.log('Testing REMOTE /api/info...');
    try {
        const res = await fetch('https://downfiles.up.railway.app/api/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        console.log('Status Remote /api/info:', res.status);
        const text = await res.text();
        console.log('Remote API Response:', text.substring(0, 500));
    } catch (e) {
        console.error('Remote fetch failed:', e.message);
    }
}

testRemote();
