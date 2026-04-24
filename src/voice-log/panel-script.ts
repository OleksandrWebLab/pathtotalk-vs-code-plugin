export const PANEL_SCRIPT = `
(function() {
    const vscode = acquireVsCodeApi();
    const INITIAL_VISIBLE_UNSTARRED = 3;
    let allRecords = [];
    let expandedIds = new Set();
    let editingId = null;
    let showingAllUnstarred = false;

    document.getElementById('clearAllBtn').onclick = function() {
        vscode.postMessage({ type: 'clearAll' });
    };

    const searchInput = document.getElementById('searchInput');
    let searchTimer = null;
    searchInput.addEventListener('input', function() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function() {
            showingAllUnstarred = false;
            vscode.postMessage({ type: 'search', query: searchInput.value });
        }, 200);
    });

    window.addEventListener('message', function(event) {
        const msg = event.data;
        switch (msg.type) {
            case 'records':
                allRecords = msg.records || [];
                document.getElementById('projectName').textContent = msg.projectName || '';
                renderRecords(allRecords);
                break;
            case 'copied':
                flashCopied(msg.id);
                break;
            case 'focusSearch':
                searchInput.focus();
                searchInput.select();
                break;
        }
    });

    function renderRecords(records) {
        const list = document.getElementById('logList');
        list.innerHTML = '';

        if (!records || records.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="empty-icon">\u{1F3A4}</div><div>No voice records yet.<br>Press Ctrl+Shift+M to start recording.</div></div>';
            return;
        }

        const starred = records.filter(r => r.starred);
        if (starred.length > 0) {
            const label = document.createElement('div');
            label.className = 'starred-section-label';
            label.textContent = '\u2B50 Starred';
            list.appendChild(label);
            starred.forEach(r => list.appendChild(buildCard(r)));
        }

        const unstarred = records.filter(r => !r.starred);
        const visibleUnstarred = showingAllUnstarred
            ? unstarred
            : unstarred.slice(0, INITIAL_VISIBLE_UNSTARRED);
        const hiddenCount = unstarred.length - visibleUnstarred.length;

        const groups = groupByDay(visibleUnstarred);
        for (const [day, dayRecords] of groups) {
            const label = document.createElement('div');
            label.className = 'day-label';
            label.textContent = day;
            list.appendChild(label);
            dayRecords.forEach(r => list.appendChild(buildCard(r)));
        }

        if (hiddenCount > 0) {
            const showMoreWrap = document.createElement('div');
            showMoreWrap.className = 'show-more-row';
            const showMoreBtn = document.createElement('button');
            showMoreBtn.className = 'action-btn';
            showMoreBtn.textContent = 'Show ' + hiddenCount + ' more record' + (hiddenCount === 1 ? '' : 's');
            showMoreBtn.onclick = function() {
                showingAllUnstarred = true;
                renderRecords(allRecords);
            };
            showMoreWrap.appendChild(showMoreBtn);
            list.appendChild(showMoreWrap);
        }
    }

    function buildCard(record) {
        const isUnread = record.copied === false;
        const card = document.createElement('div');
        card.className = 'record-card'
            + (record.starred ? ' starred' : '')
            + (isUnread ? ' unread' : '');
        card.dataset.id = record.id;

        const meta = document.createElement('div');
        meta.className = 'record-meta';

        const d = new Date(record.timestamp);
        const time = pad(d.getHours()) + ':' + pad(d.getMinutes());

        meta.innerHTML =
            (isUnread ? '<span class="unread-dot" title="Not copied yet"></span>' : '') +
            '<span class="record-time">' + escHtml(time) + '</span>' +
            '<span class="record-lang">' + escHtml(record.language) + '</span>' +
            '<span class="record-dur">' + record.duration_sec.toFixed(1) + 's</span>' +
            (record.starred ? '<span class="star-indicator">\u2B50</span>' : '');
        card.appendChild(meta);

        const isExpanded = expandedIds.has(record.id);
        const isLong = record.text.length > 150 || record.text.split('\\n').length > 3;

        if (editingId === record.id) {
            const textarea = document.createElement('textarea');
            textarea.className = 'edit-area';
            textarea.value = record.text;
            card.appendChild(textarea);

            const saveBtn = document.createElement('button');
            saveBtn.className = 'action-btn';
            saveBtn.textContent = 'Save';
            saveBtn.onclick = function() {
                editingId = null;
                vscode.postMessage({ type: 'edit', id: record.id, text: textarea.value });
            };

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'action-btn';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.onclick = function() {
                editingId = null;
                renderRecords(allRecords);
            };

            const editActions = document.createElement('div');
            editActions.className = 'record-actions';
            editActions.appendChild(saveBtn);
            editActions.appendChild(cancelBtn);
            card.appendChild(editActions);
        } else {
            const textEl = document.createElement('div');
            textEl.className = 'record-text' + (isLong && !isExpanded ? ' collapsed' : '');
            textEl.textContent = record.text;
            card.appendChild(textEl);

            const actions = document.createElement('div');
            actions.className = 'record-actions';

            if (isLong) {
                const expandBtn = document.createElement('button');
                expandBtn.className = 'action-btn';
                expandBtn.textContent = isExpanded ? 'Show less' : 'Show more';
                expandBtn.onclick = function() {
                    if (isExpanded) {
                        expandedIds.delete(record.id);
                    } else {
                        expandedIds.add(record.id);
                    }
                    renderRecords(allRecords);
                };
                actions.appendChild(expandBtn);
            }

            const copyBtn = document.createElement('button');
            copyBtn.className = 'action-btn copy-btn';
            copyBtn.dataset.copyId = record.id;
            copyBtn.textContent = '\u{1F4CB} Copy';
            copyBtn.onclick = function() {
                vscode.postMessage({ type: 'copy', id: record.id });
            };

            const starBtn = document.createElement('button');
            starBtn.className = 'action-btn';
            starBtn.textContent = record.starred ? '\u2605 Unstar' : '\u2606 Star';
            starBtn.onclick = function() {
                vscode.postMessage({ type: 'star', id: record.id, starred: !record.starred });
            };

            const editBtn = document.createElement('button');
            editBtn.className = 'action-btn';
            editBtn.textContent = '\u270F\uFE0F Edit';
            editBtn.onclick = function() {
                editingId = record.id;
                renderRecords(allRecords);
            };

            const delBtn = document.createElement('button');
            delBtn.className = 'action-btn';
            delBtn.textContent = '\u{1F5D1} Delete';
            delBtn.onclick = function() {
                vscode.postMessage({ type: 'delete', id: record.id });
            };

            actions.appendChild(copyBtn);
            actions.appendChild(starBtn);
            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
            card.appendChild(actions);
        }

        return card;
    }

    function flashCopied(id) {
        const btn = document.querySelector('[data-copy-id="' + id + '"]');
        if (!btn) return;
        btn.textContent = '\u2713 Copied!';
        btn.classList.add('copied');
        setTimeout(function() {
            btn.textContent = '\u{1F4CB} Copy';
            btn.classList.remove('copied');
        }, 1500);
    }

    function groupByDay(records) {
        const map = new Map();
        const now = new Date();
        const todayKey = dayKey(now);
        const yesterdayKey = dayKey(new Date(now.getTime() - 86400000));

        for (const r of records) {
            const d = new Date(r.timestamp);
            const key = dayKey(d);
            const dateStr = formatDate(d);
            let label;
            if (key === todayKey) {
                label = 'Today (' + dateStr + ')';
            } else if (key === yesterdayKey) {
                label = 'Yesterday (' + dateStr + ')';
            } else {
                label = dateStr;
            }
            if (!map.has(label)) {
                map.set(label, []);
            }
            map.get(label).push(r);
        }
        return map;
    }

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function dayKey(d) {
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function formatDate(d) {
        return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
    }

    function escHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    vscode.postMessage({ type: 'ready' });
})();
`;
