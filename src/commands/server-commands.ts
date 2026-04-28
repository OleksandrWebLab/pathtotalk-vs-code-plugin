import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { CommandDeps } from './types';

export function registerServerCommands(deps: CommandDeps): void {
    const { extensionContext, server, output } = deps;

    extensionContext.subscriptions.push(
        vscode.commands.registerCommand('pathtotalk.restartServer', async () => {
            await server.restart();
            vscode.window.showInformationMessage('Voice server restarted.');
        }),

        vscode.commands.registerCommand('pathtotalk.showServerLogs', () => {
            output.show();
        }),

        vscode.commands.registerCommand('pathtotalk.showExtensionLogs', () => {
            output.show();
        }),

        vscode.commands.registerCommand('pathtotalk.resetExtension', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Reset PathToTalk? This will delete the Python venv and all downloaded models.',
                { modal: true },
                'Reset',
            );
            if (confirm !== 'Reset') {
                return;
            }
            await server.stop();
            const storageDir = extensionContext.globalStorageUri.fsPath;
            fs.rmSync(path.join(storageDir, 'python-venv'), { recursive: true, force: true });
            fs.rmSync(path.join(storageDir, 'models'), { recursive: true, force: true });
            vscode.window.showInformationMessage(
                'PathToTalk reset. Restart VS Code to set up again.',
            );
        }),
    );
}
