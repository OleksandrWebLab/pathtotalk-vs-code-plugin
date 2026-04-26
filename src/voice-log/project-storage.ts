import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { VOICE_LOG_FILE } from '../constants';
import { ensureStorageDir } from './storage-readme';

const PROJECTS_DIR = 'projects';
const NO_WORKSPACE_DIR = '_no-workspace';
const META_FILE = '.meta.json';
const LEGACY_FALLBACK_DIR = 'puthtotalk-fallback';
const LEGACY_PROJECT_RELATIVE_DIR = '.vscode/puthtotalk';

export type ProjectStorageType = 'project' | 'fallback';

export interface ProjectStorageMeta {
    workspacePath: string;
    projectName: string;
    createdAt: string;
    lastUsedAt: string;
}

export interface ProjectStorageResult {
    type: ProjectStorageType;
    storageDir: string;
    logPath: string;
    projectKey: string;
    workspacePath?: string;
    projectName?: string;
}

export class ProjectStorage {
    static resolve(globalStorageDir: string): ProjectStorageResult {
        const folders = vscode.workspace.workspaceFolders;

        if (!folders || folders.length === 0) {
            const storageDir = path.join(globalStorageDir, PROJECTS_DIR, NO_WORKSPACE_DIR);
            return {
                type: 'fallback',
                storageDir,
                logPath: path.join(storageDir, VOICE_LOG_FILE),
                projectKey: NO_WORKSPACE_DIR,
            };
        }

        const config = vscode.workspace.getConfiguration('puthtotalk.log');
        const folderIndex = config.get<number>('multiRootFolder', 0);
        const folder = folders[Math.min(folderIndex, folders.length - 1)];
        const workspacePath = folder.uri.fsPath;
        const projectKey = ProjectStorage.makeProjectKey(workspacePath);
        const storageDir = path.join(globalStorageDir, PROJECTS_DIR, projectKey);

        return {
            type: 'project',
            storageDir,
            logPath: path.join(storageDir, VOICE_LOG_FILE),
            projectKey,
            workspacePath,
            projectName: folder.name,
        };
    }

    static makeProjectKey(workspacePath: string): string {
        const hash = crypto.createHash('sha256').update(workspacePath).digest('hex').slice(0, 16);
        const safeName = path.basename(workspacePath).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 32);
        return `${safeName}-${hash}`;
    }

    static ensureStorageWithMeta(result: ProjectStorageResult): void {
        ensureStorageDir(result.storageDir);
        if (result.type !== 'project' || !result.workspacePath || !result.projectName) {
            return;
        }
        ProjectStorage.writeMeta(result.storageDir, result.workspacePath, result.projectName);
    }

    static writeMeta(storageDir: string, workspacePath: string, projectName: string): void {
        const metaPath = path.join(storageDir, META_FILE);
        const now = new Date().toISOString();
        let createdAt = now;
        if (fs.existsSync(metaPath)) {
            try {
                const existing = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ProjectStorageMeta;
                createdAt = existing.createdAt ?? now;
            } catch {
                // Treat malformed meta as missing - rewrite from scratch
            }
        }
        const meta: ProjectStorageMeta = {
            workspacePath,
            projectName,
            createdAt,
            lastUsedAt: now,
        };
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    }

    static readMeta(storageDir: string): ProjectStorageMeta | null {
        const metaPath = path.join(storageDir, META_FILE);
        if (!fs.existsSync(metaPath)) {
            return null;
        }
        try {
            return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ProjectStorageMeta;
        } catch {
            return null;
        }
    }

    static migrateLegacyIfNeeded(globalStorageDir: string, result: ProjectStorageResult): boolean {
        if (result.type === 'project' && result.workspacePath) {
            return ProjectStorage.migrateLegacyProjectStorage(result);
        }
        if (result.type === 'fallback') {
            return ProjectStorage.migrateLegacyFallback(globalStorageDir, result);
        }
        return false;
    }

    private static migrateLegacyProjectStorage(result: ProjectStorageResult): boolean {
        if (!result.workspacePath) {
            return false;
        }
        const legacyDir = path.join(result.workspacePath, LEGACY_PROJECT_RELATIVE_DIR);
        if (!fs.existsSync(legacyDir)) {
            return false;
        }
        const stat = fs.statSync(legacyDir);
        if (!stat.isDirectory()) {
            return false;
        }

        ensureStorageDir(result.storageDir);
        let moved = 0;

        for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
            if (!entry.isFile()) {
                continue;
            }
            const src = path.join(legacyDir, entry.name);
            const dst = path.join(result.storageDir, entry.name);
            if (fs.existsSync(dst)) {
                continue;
            }
            try {
                fs.renameSync(src, dst);
                moved++;
            } catch {
                try {
                    fs.copyFileSync(src, dst);
                    fs.unlinkSync(src);
                    moved++;
                } catch {
                    // Skip files we cannot move
                }
            }
        }

        try {
            const remaining = fs.readdirSync(legacyDir);
            if (remaining.length === 0) {
                fs.rmdirSync(legacyDir);
                const parentVscode = path.join(result.workspacePath, '.vscode');
                if (fs.existsSync(parentVscode) && fs.readdirSync(parentVscode).length === 0) {
                    fs.rmdirSync(parentVscode);
                }
            }
        } catch {
            // Leave folder if cleanup fails
        }

        return moved > 0;
    }

    private static migrateLegacyFallback(globalStorageDir: string, result: ProjectStorageResult): boolean {
        const legacyDir = path.join(globalStorageDir, LEGACY_FALLBACK_DIR);
        if (!fs.existsSync(legacyDir)) {
            return false;
        }
        ensureStorageDir(result.storageDir);
        let moved = 0;
        for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
            if (!entry.isFile()) {
                continue;
            }
            const src = path.join(legacyDir, entry.name);
            const dst = path.join(result.storageDir, entry.name);
            if (fs.existsSync(dst)) {
                continue;
            }
            try {
                fs.renameSync(src, dst);
                moved++;
            } catch {
                // Skip
            }
        }
        try {
            if (fs.readdirSync(legacyDir).length === 0) {
                fs.rmdirSync(legacyDir);
            }
        } catch {
            // Ignore
        }
        return moved > 0;
    }
}
