import * as vscode from 'vscode';
import * as cp from 'child_process';
import { DraftRecord, LogStore } from './log-store';
import { VoiceRecord } from './types';
import { buildPanelHtml } from './panel-html';

type PanelMessage =
    | { type: 'copy'; id: string }
    | { type: 'star'; id: string; starred: boolean }
    | { type: 'delete'; id: string }
    | { type: 'edit'; id: string; text: string }
    | { type: 'search'; query: string }
    | { type: 'clearAll' }
    | { type: 'ready' }
    | { type: 'focusSearch' };

export class VoiceLogPanel implements vscode.WebviewViewProvider, vscode.Disposable {
    private view: vscode.WebviewView | null = null;
    private logStore: LogStore;
    private searchQuery: string = '';
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        logStore: LogStore,
        private readonly extensionUri: vscode.Uri,
    ) {
        this.logStore = logStore;
        this.attachStoreListeners();
    }

    updateLogStore(logStore: LogStore): void {
        // Detach old listeners
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;

        this.logStore = logStore;
        this.attachStoreListeners();
        this.refresh();
    }

    private attachStoreListeners(): void {
        this.disposables.push(
            this.logStore.onRecordAdded(() => this.refresh()),
            this.logStore.onRecordUpdated(() => this.refresh()),
            this.logStore.onRecordDeleted(() => this.refresh()),
            this.logStore.onDraftChanged(draft => this.sendDraft(draft)),
        );
    }

    private sendDraft(draft: DraftRecord | null): void {
        this.view?.webview.postMessage({ type: 'draft', draft });
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        webviewView.webview.html = buildPanelHtml(webviewView.webview, this.extensionUri);

        webviewView.webview.onDidReceiveMessage((msg: PanelMessage) => {
            this.handleMessage(msg);
        });

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.refresh();
            }
        });

        this.refresh();
    }

    focusSearch(): void {
        this.view?.webview.postMessage({ type: 'focusSearch' });
    }

    private async handleMessage(msg: PanelMessage): Promise<void> {
        switch (msg.type) {
            case 'ready':
                await this.refresh();
                break;

            case 'copy':
                await this.handleCopy(msg.id);
                break;

            case 'star':
                await this.logStore.update(msg.id, { starred: msg.starred });
                break;

            case 'delete': {
                const confirm = await vscode.window.showWarningMessage(
                    'Delete this voice record?',
                    { modal: true },
                    'Delete'
                );
                if (confirm === 'Delete') {
                    await this.logStore.delete(msg.id);
                }
                break;
            }

            case 'edit':
                await this.logStore.update(msg.id, { text: msg.text });
                break;

            case 'search':
                this.searchQuery = msg.query;
                await this.refresh();
                break;

            case 'clearAll': {
                const confirm = await vscode.window.showWarningMessage(
                    'Clear all voice log records? This cannot be undone.',
                    { modal: true },
                    'Clear All'
                );
                if (confirm === 'Clear All') {
                    await this.logStore.clear();
                    await this.refresh();
                }
                break;
            }
        }
    }

    private async handleCopy(id: string): Promise<void> {
        const record = await this.logStore.get(id);
        if (!record) {
            return;
        }
        await copyToClipboard(record.text);
        if (record.copied !== true) {
            await this.logStore.update(id, { copied: true });
        }
        this.view?.webview.postMessage({ type: 'copied', id });
    }

    private async refresh(): Promise<void> {
        if (!this.view?.visible) {
            return;
        }

        let records: VoiceRecord[];
        if (this.searchQuery.trim()) {
            records = await this.logStore.search(this.searchQuery);
        } else {
            records = await this.logStore.list();
        }

        this.view.webview.postMessage({
            type: 'records',
            records,
            projectName: this.getProjectName(),
            totalCount: this.logStore.recordCount,
        });
        this.sendDraft(this.logStore.currentDraft);
    }

    private getProjectName(): string {
        const folders = vscode.workspace.workspaceFolders;
        return folders?.[0]?.name ?? '';
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}

async function copyToClipboard(text: string): Promise<void> {
    // Try wl-copy first (Wayland preferred)
    try {
        await new Promise<void>((resolve, reject) => {
            const proc = cp.spawn('wl-copy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
            proc.stdin.write(text);
            proc.stdin.end();
            proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`wl-copy exit ${code}`))));
            proc.on('error', reject);
        });
        return;
    } catch {
        // wl-copy not available or failed
    }

    // Fallback to VS Code API
    try {
        await vscode.env.clipboard.writeText(text);
        return;
    } catch {
        // Both failed
    }

    // Last resort: modal dialog
    await vscode.window.showInformationMessage(
        'Copy failed. Select and copy text manually:',
        { modal: true, detail: text }
    );
}
