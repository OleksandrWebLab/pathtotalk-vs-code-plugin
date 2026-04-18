import * as vscode from 'vscode';
import * as path from 'path';

import { CommandDeps } from './types';
import { LogLocation } from '../voice-log/log-location';
import { GitignoreManager } from '../voice-log/gitignore-manager';
import { VOICE_LOG_GITIGNORE_PATTERN } from '../constants';

export function registerGitignoreCommands(deps: CommandDeps): void {
    const { extensionContext, globalStorageDir } = deps;

    extensionContext.subscriptions.push(
        vscode.commands.registerCommand('puthtotalk.addLogToGitignore', async () => {
            const location = LogLocation.resolve(globalStorageDir);
            if (location.type === 'fallback') {
                vscode.window.showWarningMessage('No workspace open.');
                return;
            }
            const workspaceRoot = path.dirname(path.dirname(location.path));
            const manager = new GitignoreManager(workspaceRoot);
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
            if (location.type === 'fallback') {
                vscode.window.showWarningMessage('No workspace open.');
                return;
            }
            const workspaceRoot = path.dirname(path.dirname(location.path));
            const manager = new GitignoreManager(workspaceRoot);
            await manager.removeEntry(VOICE_LOG_GITIGNORE_PATTERN);
            vscode.window.showInformationMessage(`Removed ${VOICE_LOG_GITIGNORE_PATTERN} from .gitignore.`);
        }),
    );
}
