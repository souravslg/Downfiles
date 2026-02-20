import { detectPlatform, formatSize, formatDuration, renderMarquee } from './platforms.js';

// API base — empty = same origin (works locally and on Railway/any host)
// The Express server serves both static files AND /api/* on the same domain
const API_BASE = '';

// DOM refs
const urlInput = document.getElementById('url-input');
const submitBtn = document.getElementById('submit-btn');
const pasteBtn = document.getElementById('paste-btn');
const resultPanel = document.getElementById('result-panel');
const errorBanner = document.getElementById('error-banner');
const qualityAuto = document.getElementById('quality-auto');
const qualityChoose = document.getElementById('quality-choose');
const qualityGrid = document.getElementById('quality-grid');
const resultThumb = document.getElementById('result-thumb');
const resultTitle = document.getElementById('result-title');
const resultMeta = document.getElementById('result-meta');
const downloadBtn = document.getElementById('download-btn');
const audioBtn = document.getElementById('audio-btn');

let currentInfo = null;
let selectedFormatId = 'auto';

// Init
document.addEventListener('DOMContentLoaded', () => {
    renderMarquee();
    setupFAQ();
    setupDropdown();
    setupMobileMenu();
});

// ===== Paste Button =====
pasteBtn?.addEventListener('click', async () => {
    try {
        const text = await navigator.clipboard.readText();
        urlInput.value = text;
        urlInput.dispatchEvent(new Event('input'));
    } catch {
        urlInput.focus();
    }
});

// URL input — show platform icon
urlInput?.addEventListener('input', () => {
    const val = urlInput.value.trim();
    clearError();
    if (!val) { hideResult(); return; }
});

// ===== Submit =====
submitBtn?.addEventListener('click', handleSubmit);
urlInput?.addEventListener('keydown', e => { if (e.key === 'Enter') handleSubmit(); });

async function handleSubmit() {
    const url = urlInput?.value.trim();
    if (!url) { showError('Please enter a URL.'); return; }

    if (!isValidUrl(url)) { showError('That doesn\'t look like a valid URL. Please paste a link from YouTube, TikTok, Instagram, etc.'); return; }

    setLoading(true);
    hideResult();
    clearError();

    try {
        const res = await fetch(`${API_BASE}/api/info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await res.json();

        if (!res.ok) {
            showError(data.error || 'Failed to fetch video info. Please check the URL and try again.');
            return;
        }

        currentInfo = data;
        selectedFormatId = 'auto';
        renderResult(data);
    } catch (err) {
        showError('Could not connect to server. Make sure the server is running.');
    } finally {
        setLoading(false);
    }
}

// ===== Quality Toggle =====
qualityAuto?.addEventListener('change', () => {
    qualityGrid.style.display = 'none';
    selectedFormatId = 'auto';
});
qualityChoose?.addEventListener('change', () => {
    qualityGrid.style.display = 'grid';
});

// ===== Render Result =====
function renderResult(info) {
    if (resultThumb) {
        if (info.thumbnail) {
            resultThumb.src = info.thumbnail;
            resultThumb.style.display = 'block';
        } else {
            resultThumb.style.display = 'none';
        }
    }
    if (resultTitle) resultTitle.textContent = info.title || 'Untitled Video';
    if (resultMeta) {
        const parts = [];
        if (info.uploader) parts.push(info.uploader);
        if (info.duration) parts.push(formatDuration(info.duration));
        if (info.platform) parts.push(info.platform);
        resultMeta.textContent = parts.join(' • ');
    }

    // Render quality buttons
    if (qualityGrid) {
        const videoFormats = (info.formats || []).filter(f => f.vcodec !== 'none');
        const audioFormats = (info.formats || []).filter(f => f.vcodec === 'none' && f.acodec !== 'none');

        let html = '';

        if (videoFormats.length > 0) {
            html += videoFormats.slice(0, 8).map(f => `
        <button class="quality-btn" data-format="${f.format_id}" onclick="selectFormat(this, '${f.format_id}')">
          <span>${f.resolution || f.note || f.ext}</span>
          <small>${f.ext?.toUpperCase() || ''}${f.filesize ? ' · ' + formatSize(f.filesize) : ''}</small>
        </button>
      `).join('');
        }

        if (audioFormats.length > 0) {
            html += audioFormats.slice(0, 3).map(f => `
        <button class="quality-btn" data-format="${f.format_id}" onclick="selectFormat(this, '${f.format_id}')">
          <span>🎵 Audio</span>
          <small>${f.ext?.toUpperCase() || 'M4A'}${f.tbr ? ' · ' + Math.round(f.tbr) + 'kbps' : ''}${f.filesize ? ' · ' + formatSize(f.filesize) : ''}</small>
        </button>
      `).join('');
        }

        qualityGrid.innerHTML = html || '<p style="color:var(--text-muted);font-size:0.875rem">No format list available — Auto mode will pick the best quality.</p>';
        qualityGrid.style.display = qualityChoose?.checked ? 'grid' : 'none';
    }

    if (resultPanel) {
        resultPanel.classList.add('show');
        resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// Expose to inline onclick
window.selectFormat = function (btn, formatId) {
    document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedFormatId = formatId;
};

// ===== Download =====
downloadBtn?.addEventListener('click', () => triggerDownload(false));
audioBtn?.addEventListener('click', () => triggerDownload(true));

function triggerDownload(audioOnly) {
    const url = urlInput?.value.trim();
    if (!url || !currentInfo) return;

    // Build GET download URL — server streams the file directly
    const params = new URLSearchParams({
        url,
        format_id: selectedFormatId || 'auto',
        audio_only: audioOnly ? '1' : '0',
        title: currentInfo.title || 'downfiles'
    });

    const downloadUrl = `/api/download?${params.toString()}`;

    // window.open triggers the download because the server sends
    // Content-Disposition: attachment — works better than anchor click
    window.open(downloadUrl, '_blank');
}

// ===== Helpers =====
function isValidUrl(str) {
    try { new URL(str); return true; } catch { return false; }
}

function setLoading(on) {
    if (!submitBtn) return;
    submitBtn.classList.toggle('loading', on);
    submitBtn.innerHTML = on
        ? '<div class="spinner"></div>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
    submitBtn.disabled = on;
}

function showError(msg) {
    if (!errorBanner) return;
    errorBanner.innerHTML = `<span>⚠️</span> ${msg}`;
    errorBanner.classList.add('show');
}

function clearError() {
    errorBanner?.classList.remove('show');
}

function hideResult() {
    resultPanel?.classList.remove('show');
    currentInfo = null;
}

// ===== FAQ Accordion =====
function setupFAQ() {
    document.querySelectorAll('.faq-q').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.faq-item');
            const isOpen = item.classList.contains('open');
            document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
            if (!isOpen) item.classList.add('open');
        });
    });
}

// ===== Platforms Dropdown =====
function setupDropdown() {
    const dropdown = document.querySelector('.platforms-dropdown');
    if (!dropdown) return;
    dropdown.querySelector('.dropdown-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => dropdown.classList.remove('open'));
}

// ===== Mobile Menu =====
function setupMobileMenu() {
    const btn = document.querySelector('.mobile-menu-btn');
    const links = document.querySelector('.navbar-links');
    if (!btn || !links) return;
    btn.addEventListener('click', () => links.style.display = links.style.display === 'flex' ? 'none' : 'flex');
}
