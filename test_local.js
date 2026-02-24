const fs = require('fs');

async function testLocal() {
    const url = 'https://youtu.be/GX9x62kFsVU?list=RDzlcs_1knJSA';
    console.log('Testing LOCAL /api/info...');
    try {
        const res = await fetch('http://localhost:3000/api/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        console.log('Status Local /api/info:', res.status);
        const text = await res.text();
        console.log('Local API Response:', text.substring(0, 500));
    } catch (e) {
        console.error('Local fetch failed:', e.message);
    }
}

testLocal();
