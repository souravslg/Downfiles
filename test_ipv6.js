const { execSync } = require('child_process');

try {
    const result = execSync('curl -s -6 -I https://youtube.com', { timeout: 5000 }).toString();
    console.log('IPv6 is supported:');
    console.log(result.slice(0, 500));
} catch (e) {
    console.log('IPv6 NOT supported or failed:');
    console.error(e.message);
}
