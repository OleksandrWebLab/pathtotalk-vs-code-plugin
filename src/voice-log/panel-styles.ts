export const PANEL_STYLES = `
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.header {
    padding: 8px 10px 6px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
    flex-shrink: 0;
}

.header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
}

.header-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-sideBarSectionHeader-foreground);
}

.header-project {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
}

.header-right {
    display: flex;
    align-items: center;
    gap: 6px;
}

.header-actions {
    display: flex;
    gap: 2px;
}

.icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 3px 5px;
    border-radius: 3px;
    color: var(--vscode-icon-foreground);
    font-size: 14px;
    line-height: 1;
    opacity: 0.7;
    transition: opacity 0.1s, background 0.1s;
}
.icon-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }

.search-box {
    width: 100%;
    padding: 4px 8px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border);
    color: var(--vscode-input-foreground);
    border-radius: 3px;
    font-size: 12px;
    outline: none;
}
.search-box:focus { border-color: var(--vscode-focusBorder); }
.search-box::placeholder { color: var(--vscode-input-placeholderForeground); }

.log-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
}

.day-label {
    padding: 6px 10px 3px;
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    position: sticky;
    top: 0;
    background: var(--vscode-sideBar-background);
    z-index: 1;
}

.record-card {
    padding: 6px 10px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
    cursor: default;
    transition: background 0.1s;
}
.record-card:hover { background: var(--vscode-list-hoverBackground); }
.record-card.starred { border-left: 2px solid var(--vscode-charts-yellow); }

.record-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 3px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
}

.record-time { font-variant-numeric: tabular-nums; }
.record-lang { opacity: 0.7; }
.record-dur { opacity: 0.7; }
.star-indicator { color: var(--vscode-charts-yellow); font-size: 10px; }

.record-text {
    font-size: 12px;
    line-height: 1.4;
    color: var(--vscode-foreground);
    word-break: break-word;
    cursor: text;
    user-select: text;
}

.record-text.collapsed {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.expand-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--vscode-textLink-foreground);
    font-size: 11px;
    padding: 1px 0;
    margin-top: 2px;
    display: block;
}

.record-actions {
    display: flex;
    gap: 4px;
    margin-top: 4px;
    opacity: 0;
    transition: opacity 0.15s;
}
.record-card:hover .record-actions { opacity: 1; }
.record-actions.always-visible { opacity: 1; }

.action-btn {
    background: none;
    border: 1px solid var(--vscode-button-secondaryBorder, transparent);
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 11px;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
    transition: background 0.1s;
}
.action-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.action-btn.copy-btn.copied { color: var(--vscode-charts-green); }

.edit-area {
    width: 100%;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-focusBorder);
    color: var(--vscode-input-foreground);
    border-radius: 3px;
    font-size: 12px;
    padding: 4px;
    resize: vertical;
    min-height: 60px;
    font-family: inherit;
    line-height: 1.4;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    gap: 8px;
    text-align: center;
    padding: 20px;
}

.empty-icon { font-size: 32px; opacity: 0.4; }

.starred-section-label {
    padding: 6px 10px 2px;
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-charts-yellow);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
`;
