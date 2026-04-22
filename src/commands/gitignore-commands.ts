import * as vscode from 'vscode';

import { CommandDeps } from './types';
import { LogLocation } from '../voice-log/log-location';
import { GitignoreManager } from '../voice-log/gitignore-manager';
import { VOICE_LOG_GITIGNORE_PATTERN } from '../constants';

export function registerGitignoreCommands(deps: CommandDeps): void {
    const { extensionContext, globalStorageDir } = deps;

    extensionContext.subscriptions.push(
        vscode.commands.registerCommand('puthtotalk.addLogToGitignore', async () => {
            const location = LogLocation.resolve(globalStorageDir);
            if (location.type === 'fallback' || !location.workspaceRoot) {
                vscode.window.showWarningMessage('No workspace open.');
                return;
            }
            const manager = new GitignoreManager(location.workspaceRoot);
            const result = await manager.ensureEntry(VOICE_LOG_GITIGNORE_PATTERN);
            if (result.status === 'added') {
                vscode.window.showInformationMessage(`Added ${VOICE_LOG_GITIGNORE_PATTERN} to .gitignore.`);
            } else if (result.status === 'already-covered') {
                vscode.window.showInformationMessage('Already covered in .gitignore.');
            } else {
                vscode.window.showWarningMessage('No git repository found.');
            }
        }),

        vscode.commands.registerCommand('puthtotalk.removeLogFromGitignore', async () => {
            const location = LogLocation.resolve(globalStorageDir);
            if (location.type === 'fallback' || !location.workspaceRoot) {
                vscode.window.showWarningMessage('No workspace open.');
                return;
            }
            const manager = new GitignoreManager(location.workspaceRoot);
            await manager.removeEntry(VOICE_LOG_GITIGNORE_PATTERN);
            vscode.window.showInformationMessage(`Removed ${VOICE_LOG_GITIGNORE_PATTERN} from .gitignore.`);
        }),
    );
}
