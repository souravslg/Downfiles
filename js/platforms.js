// ===== Platform Data =====
const PLATFORMS = [
    { id: 'youtube', name: 'YouTube', icon: '▶️', color: '#ff0000', domains: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'], types: ['video', 'audio', 'playlist', 'shorts'] },
    { id: 'tiktok', name: 'TikTok', icon: '🎵', color: '#010101', domains: ['tiktok.com', 'vm.tiktok.com'], types: ['video', 'audio'] },
    { id: 'instagram', name: 'Instagram', icon: '📸', color: '#e1306c', domains: ['instagram.com', 'instagr.am'], types: ['video', 'audio', 'reel', 'story'] },
    { id: 'facebook', name: 'Facebook', icon: '👤', color: '#1877f2', domains: ['facebook.com', 'fb.com', 'fb.watch'], types: ['video', 'audio'] },
    { id: 'twitter', name: 'Twitter / X', icon: '🐦', color: '#1da1f2', domains: ['twitter.com', 'x.com', 't.co'], types: ['video', 'audio'] },
    { id: 'vimeo', name: 'Vimeo', icon: '🎬', color: '#1ab7ea', domains: ['vimeo.com'], types: ['video', 'audio'] },
    { id: 'dailymotion', name: 'Dailymotion', icon: '📺', color: '#0066dc', domains: ['dailymotion.com', 'dai.ly'], types: ['video', 'audio'] },
    { id: 'twitch', name: 'Twitch', icon: '🎮', color: '#9146ff', domains: ['twitch.tv', 'clips.twitch.tv'], types: ['video', 'clips'] },
    { id: 'reddit', name: 'Reddit', icon: '🤖', color: '#ff4500', domains: ['reddit.com', 'v.redd.it', 'redd.it'], types: ['video', 'audio'] },
    { id: 'pinterest', name: 'Pinterest', icon: '📌', color: '#e60023', domains: ['pinterest.com', 'pin.it'], types: ['video', 'image'] },
    { id: 'snapchat', name: 'Snapchat', icon: '👻', color: '#fffc00', domains: ['snapchat.com'], types: ['video'] },
    { id: 'vk', name: 'VK', icon: '💬', color: '#0077ff', domains: ['vk.com', 'vkvideo.ru'], types: ['video', 'audio'] },
    { id: 'linkedin', name: 'LinkedIn', icon: '💼', color: '#0a66c2', domains: ['linkedin.com'], types: ['video'] },
    { id: 'soundcloud', name: 'SoundCloud', icon: '🎧', color: '#ff5500', domains: ['soundcloud.com', 'snd.sc'], types: ['audio'] },
    { id: 'tumblr', name: 'Tumblr', icon: '📝', color: '#35465c', domains: ['tumblr.com'], types: ['video', 'audio'] },
    { id: 'bbc', name: 'BBC', icon: '📡', color: '#bb1919', domains: ['bbc.com', 'bbc.co.uk'], types: ['video', 'audio'] },
    { id: 'bilibili', name: 'Bilibili', icon: '📱', color: '#00aeec', domains: ['bilibili.com', 'b23.tv'], types: ['video', 'audio'] },
    { id: 'rumble', name: 'Rumble', icon: '🔥', color: '#85c742', domains: ['rumble.com'], types: ['video', 'audio'] },
    { id: 'odysee', name: 'Odysee', icon: '🌊', color: '#ef1970', domains: ['odysee.com', 'lbry.tv'], types: ['video', 'audio'] },
    { id: 'streamable', name: 'Streamable', icon: '⚡', color: '#64b5f6', domains: ['streamable.com'], types: ['video'] },
    { id: 'bandcamp', name: 'Bandcamp', icon: '🎸', color: '#1da0c3', domains: ['bandcamp.com'], types: ['audio'] },
    { id: 'mixcloud', name: 'Mixcloud', icon: '☁️', color: '#52aad8', domains: ['mixcloud.com'], types: ['audio'] },
    { id: 'niconico', name: 'Niconico', icon: '🇯🇵', color: '#252525', domains: ['nicovideo.jp', 'nico.ms'], types: ['video', 'audio'] },
    { id: 'kick', name: 'Kick', icon: '👊', color: '#53fc18', domains: ['kick.com'], types: ['video', 'clips'] },
];

/**
 * Detect platform from URL
 */
function detectPlatform(url) {
    try {
        const hostname = new URL(url).hostname.replace('www.', '');
        return PLATFORMS.find(p => p.domains.some(d => hostname === d || hostname.endsWith('.' + d))) || null;
    } catch {
        return null;
    }
}

/**
 * Format file size
 */
function formatSize(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes, i = 0;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `~${size.toFixed(1)} ${units[i]}`;
}

/**
 * Format duration to mm:ss or hh:mm:ss
 */
function formatDuration(seconds) {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Render marquee platform chips
 */
function renderMarquee() {
    const track = document.querySelector('.marquee-track');
    const trackReverse = document.querySelector('.marquee-track-reverse');

    const chipHTML = p =>
        `<div class="platform-chip"><span class="icon">${p.icon}</span><span>${p.name}</span></div>`;

    if (track) {
        const doubled = [...PLATFORMS, ...PLATFORMS];
        track.innerHTML = doubled.map(chipHTML).join('');
    }

    if (trackReverse) {
        // offset by half so the two rows show different platforms at start
        const offset = [...PLATFORMS.slice(12), ...PLATFORMS.slice(0, 12)];
        const doubled = [...offset, ...offset];
        trackReverse.innerHTML = doubled.map(chipHTML).join('');
    }
}

/**
 * Render platforms grid page
 */
function renderPlatformsGrid() {
    const grid = document.querySelector('.platforms-grid');
    if (!grid) return;
    grid.innerHTML = PLATFORMS.map(p => `
    <div class="platform-card">
      <span class="icon">${p.icon}</span>
      <div class="name">${p.name}</div>
      <div class="type">${p.types.join(' · ')}</div>
    </div>
  `).join('');
}

export { PLATFORMS, detectPlatform, formatSize, formatDuration, renderMarquee, renderPlatformsGrid };
