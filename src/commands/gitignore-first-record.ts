import * as vscode from 'vscode';

import { LogLocation } from '../voice-log/log-location';
import { GitignoreManager } from '../voice-log/gitignore-manager';
import { VOICE_LOG_GITIGNORE_PATTERN } from '../constants';
import { ensureStorageDir } from '../voice-log/storage-readme';

type GitignoreBehavior = 'auto-add' | 'ask' | 'never';

export async function ensureGitignoreForFirstRecord(globalStorageDir: string): Promise<void> {
    const location = LogLocation.resolve(globalStorageDir);
    if (location.type === 'fallback' || !location.workspaceRoot) {
        return;
    }

    ensureStorageDir(location.storageDir);

    const behavior = vscode.workspace
        .getConfiguration('puthtotalk')
        .get<GitignoreBehavior>('gitignoreBehavior', 'auto-add');

    if (behavior === 'never') {
        return;
    }

    const manager = new GitignoreManager(location.workspaceRoot);
    if (!manager.hasGitRepo()) {
        return;
    }
    if (manager.isEntryPresent(VOICE_LOG_GITIGNORE_PATTERN)) {
        return;
    }

    if (behavior === 'auto-add') {
        await manager.ensureEntry(VOICE_LOG_GITIGNORE_PATTERN);
        vscode.window.showInformationMessage(
            `Voice log added to .gitignore (${VOICE_LOG_GITIGNORE_PATTERN}).`,
            'Open Settings',
        ).then(choice => {
            if (choice === 'Open Settings') {
                vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'puthtotalk.gitignoreBehavior',
                );
            }
        });
        return;
    }

    if (behavior === 'ask') {
        const answer = await vscode.window.showInformationMessage(
            `Add ${VOICE_LOG_GITIGNORE_PATTERN} to .gitignore to prevent accidental commits?`,
            'Yes',
            'No',
            "Don't ask again",
        );
        if (answer === 'Yes') {
            await manager.ensureEntry(VOICE_LOG_GITIGNORE_PATTERN);
        } else if (answer === "Don't ask again") {
            await vscode.workspace.getConfiguration('puthtotalk').update(
                'gitignoreBehavior',
                'never',
                vscode.ConfigurationTarget.Global,
            );
        }
    }
}
