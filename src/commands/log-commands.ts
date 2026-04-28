import * as vscode from 'vscode';
import * as fs from 'fs';

import { CommandDeps } from './types';
import { ProjectStorage } from '../voice-log/project-storage';

export function registerLogCommands(deps: CommandDeps): void {
    const { extensionContext, voiceLogPanel, getLogStore, globalStorageDir } = deps;

    extensionContext.subscriptions.push(
        vscode.commands.registerCommand('pathtotalk.showLog', () => {
            vscode.commands.executeCommand('pathtotalk.voiceLog.focus');
        }),

        vscode.commands.registerCommand('pathtotalk.copyLastTranscription', async () => {
            const records = await getLogStore().list();
            if (records.length === 0) {
                vscode.window.showInformationMessage('No voice records yet.');
                return;
            }
            await vscode.env.clipboard.writeText(records[0].text);
            vscode.window.showInformationMessage('Copied last transcription.');
        }),

        vscode.commands.registerCommand('pathtotalk.searchLog', () => {
            vscode.commands.executeCommand('pathtotalk.showLog');
            voiceLogPanel.focusSearch();
        }),

        vscode.commands.registerCommand('pathtotalk.clearProjectLog', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Clear all voice log records for this project?',
                { modal: true },
                'Clear All'
            );
            if (confirm === 'Clear All') {
                await getLogStore().clear();
            }
        }),

        vscode.commands.registerCommand('pathtotalk.exportLogMarkdown', async () => {
            const markdown = await getLogStore().exportMarkdown();
            const doc = await vscode.workspace.openTextDocument({
                content: markdown,
                language: 'markdown',
            });
            vscode.window.showTextDocument(doc);
        }),

        vscode.commands.registerCommand('pathtotalk.openLogFile', () => {
            const location = ProjectStorage.resolve(globalStorageDir);
            if (!fs.existsSync(location.logPath)) {
                vscode.window.showInformationMessage('No voice log file yet.');
                return;
            }
            vscode.workspace.openTextDocument(vscode.Uri.file(location.logPath))
                .then(doc => vscode.window.showTextDocument(doc));
        }),
    );
}
