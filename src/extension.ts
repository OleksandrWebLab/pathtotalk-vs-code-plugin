import * as vscode from 'vscode';

import { ServerManager } from './server-manager';
import { SetupWizard } from './setup-wizard';
import { AudioRecorder } from './audio-recorder';
import { ApiClient } from './api-client';
import { LogStore } from './voice-log/log-store';
import { ProjectStorage } from './voice-log/project-storage';
import { VoiceLogPanel } from './voice-log/panel';
import { TranscriptStore } from './voice-transcripts/transcript-store';
import { VoiceTranscriptsPanel } from './voice-transcripts/panel';
import { StatusBar } from './status-bar';
import { CommandDeps } from './commands/types';
import { registerRecordingCommands } from './commands/recording-commands';
import { registerLogCommands } from './commands/log-commands';
import { registerModelCommands } from './commands/model-commands';
import { registerServerCommands } from './commands/server-commands';
import { registerTranscribeFileCommand } from './commands/transcribe-file-command';
import { registerStorageCommands } from './commands/storage-commands';
import { ensureVocabularyFile } from './voice-log/vocabulary-store';
import { createTimestampedOutputChannel } from './lib/timestamped-channel';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = createTimestampedOutputChannel('PuthToTalk');
    context.subscriptions.push(output);

    await migrateStreamingModeSetting(output);

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
    const logStoreRef: { current: LogStore } = { current: createLogStore(globalStorageDir, output) };
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
            logStoreRef.current = createLogStore(globalStorageDir, output);
            voiceLogPanel.updateLogStore(logStoreRef.current);
            transcriptStoreRef.current = createTranscriptStore(globalStorageDir);
            voiceTranscriptsPanel.updateStore(transcriptStoreRef.current);
            updateStatusBarFallback(statusBar, globalStorageDir);
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
    registerModelCommands(deps);
    registerServerCommands(deps);
    registerStorageCommands(deps);

    context.subscriptions.push(
        vscode.commands.registerCommand('puthtotalk.showTranscripts', () => {
            vscode.commands.executeCommand('puthtotalk.voiceTranscripts.focus');
        }),
        registerTranscribeFileCommand(deps, transcriptStoreRef),
        vscode.commands.registerCommand('puthtotalk.editVocabulary', async () => {
            const location = ProjectStorage.resolve(globalStorageDir);
            ProjectStorage.ensureStorageWithMeta(location);
            const filePath = ensureVocabularyFile(location.storageDir);
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);
        }),
    );

    if (vscode.workspace.getConfiguration('puthtotalk.log').get<boolean>('autoOpenPanel', false)) {
        vscode.commands.executeCommand('puthtotalk.showLog');
    }
}

export async function deactivate(): Promise<void> {
    // ServerManager.dispose() handles process kill via subscriptions
}

function createLogStore(globalStorageDir: string, output: vscode.OutputChannel): LogStore {
    const location = ProjectStorage.resolve(globalStorageDir);
    const migrated = ProjectStorage.migrateLegacyIfNeeded(globalStorageDir, location);
    ProjectStorage.ensureStorageWithMeta(location);
    if (migrated) {
        output.appendLine(`[Storage] Migrated legacy data to ${location.storageDir}`);
        notifyMigrated(location.storageDir);
    }
    return new LogStore(location.logPath);
}

function createTranscriptStore(globalStorageDir: string): TranscriptStore {
    const location = ProjectStorage.resolve(globalStorageDir);
    return new TranscriptStore(location.storageDir);
}

function updateStatusBarFallback(statusBar: StatusBar, globalStorageDir: string): void {
    const location = ProjectStorage.resolve(globalStorageDir);
    statusBar.setFallback(location.type === 'fallback');
}

async function migrateStreamingModeSetting(output: vscode.OutputChannel): Promise<void> {
    const config = vscode.workspace.getConfiguration('puthtotalk');
    const inspected = config.inspect<unknown>('streamingMode');
    if (!inspected) {
        return;
    }
    const candidates: Array<{ value: unknown; target: vscode.ConfigurationTarget }> = [
        { value: inspected.globalValue, target: vscode.ConfigurationTarget.Global },
        { value: inspected.workspaceValue, target: vscode.ConfigurationTarget.Workspace },
        { value: inspected.workspaceFolderValue, target: vscode.ConfigurationTarget.WorkspaceFolder },
    ];
    for (const { value, target } of candidates) {
        if (typeof value !== 'boolean') {
            continue;
        }
        const next = value ? 'on' : 'off';
        try {
            await config.update('streamingMode', next, target);
            output.appendLine(`[Migration] streamingMode boolean ${value} → "${next}" at target ${target}`);
        } catch (err) {
            output.appendLine(`[Migration] streamingMode update failed at target ${target}: ${err}`);
        }
    }
}

function notifyMigrated(storageDir: string): void {
    vscode.window.showInformationMessage(
        'PuthToTalk: voice data moved to global storage. Old project folder (.vscode/puthtotalk) was removed.',
        'Open Storage Folder',
    ).then(choice => {
        if (choice === 'Open Storage Folder') {
            vscode.env.openExternal(vscode.Uri.file(storageDir));
        }
    });
}
