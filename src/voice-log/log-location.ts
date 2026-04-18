import * as vscode from 'vscode';
import * as path from 'path';

export type LogLocationType = 'project' | 'fallback';

export interface LogLocationResult {
    type: LogLocationType;
    path: string;
    projectName?: string;
}

export class LogLocation {
    static resolve(globalStorageDir: string): LogLocationResult {
        const folders = vscode.workspace.workspaceFolders;

        if (!folders || folders.length === 0) {
            return {
                type: 'fallback',
                path: path.join(globalStorageDir, 'voice-logs-fallback', '_global.jsonl'),
            };
        }

        const config = vscode.workspace.getConfiguration('puthtotalk.log');
        const folderIndex = config.get<number>('multiRootFolder', 0);
        const folder = folders[Math.min(folderIndex, folders.length - 1)];

        return {
            type: 'project',
            path: path.join(folder.uri.fsPath, '.vscode', 'voice-log.jsonl'),
            projectName: folder.name,
        };
    }
}
