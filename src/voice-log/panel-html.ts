import * as vscode from 'vscode';

import { PANEL_STYLES } from './panel-styles';
import { PANEL_SCRIPT } from './panel-script';

export function buildPanelHtml(_webview: vscode.Webview, _extensionUri: vscode.Uri): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Voice Log</title>
<style nonce="${nonce}">${PANEL_STYLES}</style>
</head>
<body>

<div class="header">
    <div class="header-row">
        <span class="header-title">Voice Log</span>
        <div class="header-right">
            <span class="header-project" id="projectName"></span>
            <div class="header-actions">
                <button class="icon-btn" id="editVocabularyBtn" title="Edit project vocabulary (terms Whisper should recognize)">&#x1F4D6;</button>
                <button class="icon-btn" id="clearAllBtn" title="Clear all records">&#x1F5D1;</button>
            </div>
        </div>
    </div>
    <input class="search-box" id="searchInput" type="text" placeholder="Search...">
</div>

<div class="log-list" id="logList"></div>

<script nonce="${nonce}">${PANEL_SCRIPT}</script>
</body>
</html>`;
}

function getNonce(): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return text;
}
