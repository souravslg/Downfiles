async function testRemoteSysinfo() {
    console.log('Testing REMOTE /api/sysinfo...');
    try {
        const res = await fetch('https://downfiles.up.railway.app/api/sysinfo');
        console.log('Status Remote /api/sysinfo:', res.status);
        const text = await res.json();
        console.log(text);
    } catch (e) {
        console.error('Remote fetch failed:', e.message);
    }
}

testRemoteSysinfo();
