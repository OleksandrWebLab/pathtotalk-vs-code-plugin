import * as path from 'path';
import * as vscode from 'vscode';

import { CommandDeps } from './types';
import { ProjectStorage } from '../voice-log/project-storage';

const PROJECTS_DIR = 'projects';

export function registerStorageCommands(deps: CommandDeps): void {
    const { extensionContext, globalStorageDir } = deps;

    extensionContext.subscriptions.push(
        vscode.commands.registerCommand('puthtotalk.openStorageFolder', async () => {
            const location = ProjectStorage.resolve(globalStorageDir);
            ProjectStorage.ensureStorageWithMeta(location);
            await vscode.env.openExternal(vscode.Uri.file(location.storageDir));
        }),

        vscode.commands.registerCommand('puthtotalk.openGlobalStorageFolder', async () => {
            const root = path.join(globalStorageDir, PROJECTS_DIR);
            await vscode.env.openExternal(vscode.Uri.file(root));
        }),
    );
}
