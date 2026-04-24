export const TRANSCRIPTS_PANEL_SCRIPT = `
(function() {
    const vscode = acquireVsCodeApi();
    let items = [];

    document.getElementById('newBtn').onclick = function() {
        vscode.postMessage({ type: 'transcribeFile' });
    };

    window.addEventListener('message', function(event) {
        const msg = event.data;
        if (msg.type === 'items') {
            items = msg.items || [];
            render(items);
        }
    });

    function render(list) {
        const container = document.getElementById('list');
        container.innerHTML = '';

        if (!list || list.length === 0) {
            container.innerHTML =
                '<div class="empty-state">' +
                '<div class="empty-icon">\u{1F4DD}</div>' +
                '<div>No transcripts yet.<br>Click "Transcribe file" to start.</div>' +
                '</div>';
            return;
        }

        for (const item of list) {
            container.appendChild(buildCard(item));
        }
    }

    function buildCard(item) {
        const card = document.createElement('div');
        card.className = 'transcript-card';
        card.onclick = function(event) {
            if (event.target.classList.contains('action-btn')) return;
            vscode.postMessage({ type: 'open', id: item.id });
        };

        const name = document.createElement('div');
        name.className = 'transcript-name';
        name.textContent = item.sourceName;
        card.appendChild(name);

        const meta = document.createElement('div');
        meta.className = 'transcript-meta';

        const created = new Date(item.createdAt);

        meta.innerHTML =
            '<span class="transcript-date">' + escHtml(formatDateTime(created)) + '</span>' +
            (item.language ? '<span class="transcript-lang">' + escHtml(item.language) + '</span>' : '') +
            (item.durationSec ? '<span class="transcript-duration">' + formatDuration(item.durationSec) + '</span>' : '') +
            '<span class="transcript-size">' + formatSize(item.sizeBytes) + '</span>';
        card.appendChild(meta);

        if (item.summary) {
            const summaryEl = document.createElement('div');
            summaryEl.className = 'transcript-summary';
            summaryEl.textContent = item.summary;
            card.appendChild(summaryEl);
        }

        const actions = document.createElement('div');
        actions.className = 'transcript-actions';

        const openBtn = document.createElement('button');
        openBtn.className = 'action-btn';
        openBtn.textContent = '\u{1F4C4} Open';
        openBtn.onclick = function() { vscode.postMessage({ type: 'open', id: item.id }); };

        const revealBtn = document.createElement('button');
        revealBtn.className = 'action-btn';
        revealBtn.textContent = '\u{1F4C2} Reveal';
        revealBtn.onclick = function() { vscode.postMessage({ type: 'reveal', id: item.id }); };

        const delBtn = document.createElement('button');
        delBtn.className = 'action-btn';
        delBtn.textContent = '\u{1F5D1} Delete';
        delBtn.onclick = function() { vscode.postMessage({ type: 'delete', id: item.id }); };

        actions.appendChild(openBtn);
        actions.appendChild(revealBtn);
        actions.appendChild(delBtn);
        card.appendChild(actions);

        return card;
    }

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function formatDateTime(d) {
        return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear()
            + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function formatDuration(sec) {
        const total = Math.round(sec);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) return h + 'h ' + m + 'm';
        if (m > 0) return m + 'm ' + s + 's';
        return s + 's';
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function escHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    vscode.postMessage({ type: 'ready' });
})();
`;
