import * as vscode from 'vscode';

import { ServerManager } from './server-manager';
import { SetupWizard } from './setup-wizard';
import { AudioRecorder } from './audio-recorder';
import { ApiClient } from './api-client';
import { LogStore } from './voice-log/log-store';
import { LogLocation } from './voice-log/log-location';
import { VoiceLogPanel } from './voice-log/panel';
import { TranscriptStore } from './voice-transcripts/transcript-store';
import { VoiceTranscriptsPanel } from './voice-transcripts/panel';
import { StatusBar } from './status-bar';
import { CommandDeps } from './commands/types';
import { registerRecordingCommands } from './commands/recording-commands';
import { registerLogCommands } from './commands/log-commands';
import { registerGitignoreCommands } from './commands/gitignore-commands';
import { registerModelCommands } from './commands/model-commands';
import { registerServerCommands } from './commands/server-commands';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('PuthToTalk');
    context.subscriptions.push(output);

    const setup = new SetupWizard(context);
    if (!(await setup.isReady())) {
        const ok = await setup.runFirstTimeSetup();
        if (!ok) {
            output.appendLine('[Extension] Setup skipped or failed. Extension inactive.');
            return;
        }
    }

    await setup.checkSystemDependencies();

    const server = new ServerManager(context, output);
    context.subscriptions.push(server);
    server.start().catch(err => {
        output.appendLine(`[Extension] Server start error: ${err}`);
    });

    const apiClient = new ApiClient();
    server.onStatusChanged(status => {
        if (status === 'ready') {
            apiClient.configure(server.port!, server.token);
        }
    });

    const globalStorageDir = context.globalStorageUri.fsPath;
    const logStoreRef: { current: LogStore } = { current: createLogStore(globalStorageDir) };
    const transcriptStoreRef: { current: TranscriptStore } = { current: createTranscriptStore(globalStorageDir) };

    const recorder = new AudioRecorder();
    context.subscriptions.push(recorder);

    const voiceLogPanel = new VoiceLogPanel(logStoreRef.current, context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('puthtotalk.voiceLog', voiceLogPanel),
        voiceLogPanel,
    );

    const voiceTranscriptsPanel = new VoiceTranscriptsPanel(transcriptStoreRef.current, context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('puthtotalk.voiceTranscripts', voiceTranscriptsPanel),
        voiceTranscriptsPanel,
        transcriptStoreRef.current,
    );

    const statusBar = new StatusBar(server, recorder, logStoreRef.current);
    context.subscriptions.push(statusBar);
    updateStatusBarFallback(statusBar, globalStorageDir);

    context.subscriptions.push(
        recorder.onStateChanged(state => {
            if (state === 'idle') {
                vscode.commands.executeCommand('setContext', 'puthtotalk.isRecording', false);
            }
        }),
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            logStoreRef.current = createLogStore(globalStorageDir);
            voiceLogPanel.updateLogStore(logStoreRef.current);
            transcriptStoreRef.current = createTranscriptStore(globalStorageDir);
            voiceTranscriptsPanel.updateStore(transcriptStoreRef.current);
            updateStatusBarFallback(statusBar, globalStorageDir);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('puthtotalk.showTranscripts', () => {
            vscode.commands.executeCommand('puthtotalk.voiceTranscripts.focus');
        }),
        vscode.commands.registerCommand('puthtotalk.transcribeFile', () => {
            vscode.window.showInformationMessage('Transcribe File: coming in next step.');
        }),
    );

    const deps: CommandDeps = {
        extensionContext: context,
        server,
        recorder,
        apiClient,
        voiceLogPanel,
        output,
        globalStorageDir,
        getLogStore: () => logStoreRef.current,
    };

    registerRecordingCommands(deps);
    registerLogCommands(deps);
    registerGitignoreCommands(deps);
    registerModelCommands(deps);
    registerServerCommands(deps);

    if (vscode.workspace.getConfiguration('puthtotalk.log').get<boolean>('autoOpenPanel', false)) {
        vscode.commands.executeCommand('puthtotalk.showLog');
    }
}

export async function deactivate(): Promise<void> {
    // ServerManager.dispose() handles process kill via subscriptions
}

function createLogStore(globalStorageDir: string): LogStore {
    const location = LogLocation.resolve(globalStorageDir);
    LogLocation.migrateLegacyIfNeeded(location);
    return new LogStore(location.path);
}

function createTranscriptStore(globalStorageDir: string): TranscriptStore {
    const location = LogLocation.resolve(globalStorageDir);
    return new TranscriptStore(location.storageDir);
}

function updateStatusBarFallback(statusBar: StatusBar, globalStorageDir: string): void {
    const location = LogLocation.resolve(globalStorageDir);
    statusBar.setFallback(location.type === 'fallback');
}
