async function testInvidious() {
    const videoId = 'GX9x62kFsVU';
    console.log('Testing invidious api for formats...');
    try {
        const res = await fetch(`https://inv.tux.pizza/api/v1/videos/${videoId}`);
        const data = await res.json();
        if (data.formatStreams) {
            console.log('got formats:', data.formatStreams.length);
            console.log('Sample format:', data.formatStreams[0]);
        } else {
            console.log('No formats, data:', data);
        }
    } catch (e) {
        console.error(e.message);
    }
}

testInvidious();
