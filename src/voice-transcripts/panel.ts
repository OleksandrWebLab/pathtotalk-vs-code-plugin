import * as path from 'path';
import * as vscode from 'vscode';

import { TranscriptStore } from './transcript-store';
import { buildTranscriptsPanelHtml } from './panel-html';

type PanelMessage =
    | { type: 'ready' }
    | { type: 'transcribeFile' }
    | { type: 'open'; id: string }
    | { type: 'reveal'; id: string }
    | { type: 'delete'; id: string };

export class VoiceTranscriptsPanel implements vscode.WebviewViewProvider, vscode.Disposable {
    private view: vscode.WebviewView | null = null;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private store: TranscriptStore,
        private readonly extensionUri: vscode.Uri,
    ) {
        this.attachStoreListeners();
    }

    updateStore(store: TranscriptStore): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;
        this.store = store;
        this.attachStoreListeners();
        this.refresh();
    }

    private attachStoreListeners(): void {
        this.disposables.push(this.store.onChanged(() => this.refresh()));
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

        webviewView.webview.html = buildTranscriptsPanelHtml(webviewView.webview, this.extensionUri);

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

    private async handleMessage(msg: PanelMessage): Promise<void> {
        switch (msg.type) {
            case 'ready':
                await this.refresh();
                break;

            case 'transcribeFile':
                await vscode.commands.executeCommand('puthtotalk.transcribeFile');
                break;

            case 'open': {
                const fullPath = path.join(this.store.storageDir, msg.id);
                const doc = await vscode.workspace.openTextDocument(fullPath);
                await vscode.window.showTextDocument(doc);
                break;
            }

            case 'reveal': {
                const fullPath = path.join(this.store.storageDir, msg.id);
                await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(fullPath));
                break;
            }

            case 'delete': {
                const confirm = await vscode.window.showWarningMessage(
                    `Delete transcript "${msg.id}"?`,
                    { modal: true },
                    'Delete',
                );
                if (confirm === 'Delete') {
                    await this.store.delete(msg.id);
                }
                break;
            }
        }
    }

    private async refresh(): Promise<void> {
        if (!this.view?.visible) {
            return;
        }
        const items = await this.store.list();
        this.view.webview.postMessage({ type: 'items', items });
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
