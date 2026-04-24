import * as vscode from 'vscode';

import { TRANSCRIPTS_PANEL_STYLES } from './panel-styles';
import { TRANSCRIPTS_PANEL_SCRIPT } from './panel-script';

export function buildTranscriptsPanelHtml(_webview: vscode.Webview, _extensionUri: vscode.Uri): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Voice Transcripts</title>
<style nonce="${nonce}">${TRANSCRIPTS_PANEL_STYLES}</style>
</head>
<body>

<div class="header">
    <div class="header-row">
        <span class="header-title">Voice Transcripts</span>
        <div class="header-actions">
            <button class="icon-btn" id="editVocabularyBtn" title="Edit project vocabulary (terms Whisper should recognize)">&#x1F4D6;</button>
            <button class="primary-btn" id="newBtn" title="Transcribe an audio or video file">+ Transcribe file</button>
        </div>
    </div>
</div>

<div class="transcript-list" id="list"></div>

<script nonce="${nonce}">${TRANSCRIPTS_PANEL_SCRIPT}</script>
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
