import * as vscode from 'vscode';
import { ServerManager } from '../server-manager';
import { AudioRecorder } from '../audio-recorder';
import { ApiClient } from '../api-client';
import { LogStore } from '../voice-log/log-store';
import { VoiceLogPanel } from '../voice-log/panel';

export interface CommandDeps {
    readonly extensionContext: vscode.ExtensionContext;
    readonly server: ServerManager;
    readonly recorder: AudioRecorder;
    readonly apiClient: ApiClient;
    readonly voiceLogPanel: VoiceLogPanel;
    readonly output: vscode.OutputChannel;
    readonly globalStorageDir: string;
    readonly getLogStore: () => LogStore;
}
