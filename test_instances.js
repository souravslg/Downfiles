async function getInstances() {
    try {
        const res = await fetch('https://cobalt-api.vcc.icu/api/serverInfo');
        console.log(await res.text());
    } catch (e) {
        console.error(e.message);
    }
}

getInstances();
