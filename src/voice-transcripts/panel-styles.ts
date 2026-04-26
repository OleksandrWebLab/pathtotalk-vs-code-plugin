export const TRANSCRIPTS_PANEL_STYLES = `
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
    gap: 6px;
}

.header-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-sideBarSectionHeader-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
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

.primary-btn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    cursor: pointer;
    padding: 4px 10px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
    transition: background 0.1s;
}
.primary-btn:hover { background: var(--vscode-button-hoverBackground); }

.transcript-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
}

.transcript-card {
    padding: 8px 10px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
    cursor: pointer;
    transition: background 0.1s;
}
.transcript-card:hover { background: var(--vscode-list-hoverBackground); }

.transcript-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--vscode-foreground);
    word-break: break-word;
    margin-bottom: 3px;
}

.transcript-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    flex-wrap: wrap;
}

.transcript-date { font-variant-numeric: tabular-nums; }

.transcript-summary {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--vscode-foreground);
    opacity: 0.85;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
}

.transcript-lang { opacity: 0.7; text-transform: uppercase; }
.transcript-duration { opacity: 0.7; }
.transcript-size { opacity: 0.7; }

.transcript-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 4px;
}

.action-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--vscode-textLink-foreground);
    font-size: 11px;
    padding: 1px 0;
}
.action-btn:hover { text-decoration: underline; }

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
`;
