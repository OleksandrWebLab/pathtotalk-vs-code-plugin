import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { PUTHTOTALK_STORAGE_DIR, VOICE_LOG_FILE } from '../constants';
import { ensureStorageDir } from './storage-readme';

export type LogLocationType = 'project' | 'fallback';

export interface LogLocationResult {
    type: LogLocationType;
    path: string;
    storageDir: string;
    workspaceRoot?: string;
    projectName?: string;
}

export class LogLocation {
    static resolve(globalStorageDir: string): LogLocationResult {
        const folders = vscode.workspace.workspaceFolders;

        if (!folders || folders.length === 0) {
            const storageDir = path.join(globalStorageDir, 'puthtotalk-fallback');
            return {
                type: 'fallback',
                path: path.join(storageDir, VOICE_LOG_FILE),
                storageDir,
            };
        }

        const config = vscode.workspace.getConfiguration('puthtotalk.log');
        const folderIndex = config.get<number>('multiRootFolder', 0);
        const folder = folders[Math.min(folderIndex, folders.length - 1)];
        const workspaceRoot = folder.uri.fsPath;
        const storageDir = path.join(workspaceRoot, PUTHTOTALK_STORAGE_DIR);

        return {
            type: 'project',
            path: path.join(storageDir, VOICE_LOG_FILE),
            storageDir,
            workspaceRoot,
            projectName: folder.name,
        };
    }

    static migrateLegacyIfNeeded(result: LogLocationResult): void {
        if (!result.workspaceRoot) {
            return;
        }
        const legacyPath = path.join(result.workspaceRoot, '.vscode', VOICE_LOG_FILE);
        if (!fs.existsSync(legacyPath)) {
            return;
        }
        if (fs.existsSync(result.path)) {
            return;
        }
        ensureStorageDir(result.storageDir);
        fs.renameSync(legacyPath, result.path);
    }
}
