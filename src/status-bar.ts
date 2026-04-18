import * as vscode from 'vscode';
import { ServerManager, ServerStatus } from './server-manager';
import { AudioRecorder, RecorderState } from './audio-recorder';
import { LogStore } from './voice-log/log-store';

export class StatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private readonly disposables: vscode.Disposable[] = [];
    private logStore: LogStore;
    private logStoreSubscriptions: vscode.Disposable[] = [];
    private isFallback: boolean = false;

    constructor(
        private readonly server: ServerManager,
        private readonly recorder: AudioRecorder,
        logStore: LogStore,
    ) {
        this.logStore = logStore;
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.item.command = 'puthtotalk.showLog';
        this.item.show();

        this.disposables.push(
            server.onStatusChanged(() => this.update()),
            recorder.onStateChanged(() => this.update()),
            recorder.onLevel(level => this.updateLevel(level)),
        );

        this.subscribeToLogStore();
        this.update();
    }

    setFallback(isFallback: boolean): void {
        this.isFallback = isFallback;
        this.update();
    }

    updateLogStore(logStore: LogStore): void {
        this.logStore = logStore;
        this.logStoreSubscriptions.forEach(d => d.dispose());
        this.logStoreSubscriptions = [];
        this.subscribeToLogStore();
        this.update();
    }

    private subscribeToLogStore(): void {
        this.logStoreSubscriptions.push(
            this.logStore.onRecordAdded(() => this.update()),
            this.logStore.onRecordDeleted(() => this.update()),
        );
    }

    private update(): void {
        const recorderState = this.recorder.state;
        const serverStatus = this.server.status;

        if (recorderState === 'recording') {
            this.item.text = '$(record) Voice: Recording';
            this.item.tooltip = 'Recording - release Ctrl+Shift+M to stop';
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            return;
        }

        if (recorderState === 'processing') {
            this.item.text = '$(loading~spin) Voice: Transcribing';
            this.item.tooltip = 'Sending audio to Whisper...';
            this.item.backgroundColor = undefined;
            return;
        }

        this.item.backgroundColor = undefined;

        switch (serverStatus) {
            case 'stopped':
                this.item.text = '$(mic) Voice: Stopped';
                this.item.tooltip = 'Voice server is not running';
                break;

            case 'starting':
                this.item.text = '$(loading~spin) Voice: Loading';
                this.item.tooltip = 'Starting Whisper server...';
                break;

            case 'ready': {
                const count = this.logStore.recordCount;
                const suffix = this.isFallback ? ' (no project)' : '';
                this.item.text = `$(mic) Voice: ${count}${suffix}`;
                this.item.tooltip = `${count} voice record${count !== 1 ? 's' : ''} - click to open Voice Log`;
                break;
            }

            case 'error':
                this.item.text = '$(warning) Voice: Error';
                this.item.tooltip = 'Voice server error - click to view log';
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
        }
    }

    private updateLevel(level: number): void {
        if (this.recorder.state !== 'recording') {
            return;
        }
        const bars = Math.round(level * 5);
        const indicator = '▁▂▃▄▅'.slice(0, Math.max(1, bars)) || '▁';
        this.item.text = `$(record) Voice: ${indicator}`;
    }

    dispose(): void {
        this.item.dispose();
        this.disposables.forEach(d => d.dispose());
        this.logStoreSubscriptions.forEach(d => d.dispose());
    }
}
