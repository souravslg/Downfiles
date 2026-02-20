const jobInput = document.getElementById('job-input');
const trackBtn = document.getElementById('track-btn');
const statusCard = document.getElementById('status-card');

let pollInterval = null;

trackBtn?.addEventListener('click', startTracking);
jobInput?.addEventListener('keydown', e => { if (e.key === 'Enter') startTracking(); });

// Pre-fill from URL param
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(location.search);
    const jobId = params.get('jobId');
    if (jobId && jobInput) {
        jobInput.value = jobId;
        startTracking();
    }
});

function startTracking() {
    const jobId = jobInput?.value.trim();
    if (!jobId) { alert('Please enter a Job ID.'); return; }

    clearInterval(pollInterval);
    pollInterval = setInterval(() => pollStatus(jobId), 2000);
    pollStatus(jobId);
}

async function pollStatus(jobId) {
    try {
        const res = await fetch(`/api/status/${jobId}`);
        if (!res.ok) {
            showStatus('error', 'Job not found. Please check the Job ID.');
            clearInterval(pollInterval);
            return;
        }
        const data = await res.json();
        updateStatusUI(data, jobId);

        if (data.status === 'done' || data.status === 'failed') {
            clearInterval(pollInterval);
        }
    } catch {
        showStatus('error', 'Could not connect to server.');
        clearInterval(pollInterval);
    }
}

function updateStatusUI(job, jobId) {
    if (!statusCard) return;
    statusCard.classList.add('show');

    const statusMap = {
        queued: { label: 'Queued', color: 'queued', icon: '⏳', desc: 'Your download is queued and will start shortly.' },
        processing: { label: 'Processing', color: 'processing', icon: '⚡', desc: 'Downloading and converting your media...' },
        done: { label: 'Ready!', color: 'done', icon: '✅', desc: 'Your download is ready!' },
        failed: { label: 'Failed', color: 'failed', icon: '❌', desc: 'Something went wrong. Please try again.' },
    };

    const s = statusMap[job.status] || statusMap.queued;

    statusCard.innerHTML = `
    <div class="status-indicator">
      <div class="status-dot ${s.color}"></div>
      <span style="font-weight:700">${s.icon} ${s.label}</span>
    </div>
    <p style="font-size:0.875rem;color:var(--text-muted);margin-bottom:1rem">${s.desc}</p>
    <div style="font-size:0.78rem;color:#555;font-family:monospace;margin-bottom:1rem">Job ID: ${jobId}</div>
    ${job.status === 'processing' ? `
      <div class="progress-bar">
        <div class="progress-fill" style="width:${job.progress || 0}%"></div>
      </div>
      <p style="font-size:0.75rem;color:var(--text-muted);margin-top:0.5rem">${(job.progress || 0).toFixed(1)}% complete</p>
    ` : ''}
    ${job.status === 'done' ? `
      <a href="/api/stream/${jobId}" style="display:inline-flex;align-items:center;gap:0.5rem;margin-top:0.5rem;padding:0.65rem 1.5rem;border-radius:9999px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-weight:700;font-size:0.875rem;text-decoration:none">
        ⬇️ Download File
      </a>
    ` : ''}
  `;
}

function showStatus(type, message) {
    if (!statusCard) return;
    statusCard.classList.add('show');
    statusCard.innerHTML = `<p style="color:${type === 'error' ? '#f87171' : 'var(--text)'}">${message}</p>`;
}
