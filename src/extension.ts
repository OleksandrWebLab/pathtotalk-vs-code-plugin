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
import { ensureVocabularyFile, getVocabularyTemplate, vocabularyPath } from './voice-log/vocabulary-store';
import * as fs from 'fs';
import * as path from 'path';
import { createTimestampedOutputChannel } from './lib/timestamped-channel';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = createTimestampedOutputChannel('PathToTalk');
    context.subscriptions.push(output);

    migrateLegacyGlobalStorage(context.globalStorageUri.fsPath, output);

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
        vscode.window.registerWebviewViewProvider('pathtotalk.voiceLog', voiceLogPanel),
        voiceLogPanel,
    );

    const voiceTranscriptsPanel = new VoiceTranscriptsPanel(transcriptStoreRef.current, context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('pathtotalk.voiceTranscripts', voiceTranscriptsPanel),
        voiceTranscriptsPanel,
        transcriptStoreRef.current,
    );

    const statusBar = new StatusBar(server, recorder, logStoreRef.current);
    context.subscriptions.push(statusBar);
    updateStatusBarFallback(statusBar, globalStorageDir);

    context.subscriptions.push(
        recorder.onStateChanged(state => {
            if (state === 'idle') {
                vscode.commands.executeCommand('setContext', 'pathtotalk.isRecording', false);
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
        vscode.commands.registerCommand('pathtotalk.showTranscripts', () => {
            vscode.commands.executeCommand('pathtotalk.voiceTranscripts.focus');
        }),
        registerTranscribeFileCommand(deps, transcriptStoreRef),
        vscode.commands.registerCommand('pathtotalk.editVocabulary', async () => {
            const location = ProjectStorage.resolve(globalStorageDir);
            ProjectStorage.ensureStorageWithMeta(location);
            const filePath = ensureVocabularyFile(location.storageDir);
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);
        }),
        vscode.commands.registerCommand('pathtotalk.resetVocabularyToDefault', async () => {
            const location = ProjectStorage.resolve(globalStorageDir);
            ProjectStorage.ensureStorageWithMeta(location);
            const filePath = vocabularyPath(location.storageDir);
            if (fs.existsSync(filePath)) {
                const choice = await vscode.window.showWarningMessage(
                    'Replace the current project vocabulary with the bundled default list? Your current vocabulary file will be overwritten.',
                    { modal: true },
                    'Replace',
                );
                if (choice !== 'Replace') {
                    return;
                }
            }
            fs.writeFileSync(filePath, getVocabularyTemplate(), 'utf8');
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);
        }),
    );

    if (vscode.workspace.getConfiguration('pathtotalk.log').get<boolean>('autoOpenPanel', false)) {
        vscode.commands.executeCommand('pathtotalk.showLog');
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

function migrateLegacyGlobalStorage(currentDir: string, output: vscode.OutputChannel): void {
    const parentDir = path.dirname(currentDir);
    const currentName = path.basename(currentDir);
    if (!currentName.includes('pathtotalk')) {
        return;
    }
    const legacyName = currentName.replace('pathtotalk', 'puthtotalk');
    const legacyDir = path.join(parentDir, legacyName);

    if (!fs.existsSync(legacyDir)) {
        return;
    }

    if (fs.existsSync(currentDir) && fs.readdirSync(currentDir).length > 0) {
        output.appendLine(`[Migration] Skipping legacy storage move: ${currentDir} already populated`);
        return;
    }

    try {
        if (fs.existsSync(currentDir)) {
            fs.rmdirSync(currentDir);
        }
        fs.renameSync(legacyDir, currentDir);
        output.appendLine(`[Migration] Moved legacy global storage ${legacyDir} → ${currentDir}`);
    } catch (err) {
        output.appendLine(`[Migration] Failed to move legacy global storage: ${err}`);
    }
}

async function migrateStreamingModeSetting(output: vscode.OutputChannel): Promise<void> {
    const config = vscode.workspace.getConfiguration('pathtotalk');
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
        'PathToTalk: voice data moved to global storage. Old project folder (.vscode/pathtotalk) was removed.',
        'Open Storage Folder',
    ).then(choice => {
        if (choice === 'Open Storage Folder') {
            vscode.env.openExternal(vscode.Uri.file(storageDir));
        }
    });
}
