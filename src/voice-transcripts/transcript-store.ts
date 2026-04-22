import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { TranscriptFile } from './types';

const TRANSCRIPT_EXTENSION = '.md';
const HEADER_PATTERN = /^<!--\s*puthtotalk:transcript\s+(\{.*\})\s*-->/;

interface TranscriptHeader {
    source?: string;
    created_at?: string;
    duration_sec?: number;
    language?: string;
}

export class TranscriptStore implements vscode.Disposable {
    private readonly onChangedEmitter = new vscode.EventEmitter<void>();
    readonly onChanged = this.onChangedEmitter.event;

    private watcher: fs.FSWatcher | null = null;

    constructor(public readonly storageDir: string) {
        this.startWatching();
    }

    updateStorageDir(newDir: string): void {
        if (newDir === this.storageDir) {
            return;
        }
        (this as { storageDir: string }).storageDir = newDir;
        this.stopWatching();
        this.startWatching();
        this.onChangedEmitter.fire();
    }

    async list(): Promise<TranscriptFile[]> {
        if (!fs.existsSync(this.storageDir)) {
            return [];
        }

        const entries = fs.readdirSync(this.storageDir, { withFileTypes: true });
        const files: TranscriptFile[] = [];

        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith(TRANSCRIPT_EXTENSION)) {
                continue;
            }

            const fullPath = path.join(this.storageDir, entry.name);
            const stat = fs.statSync(fullPath);
            const header = this.readHeader(fullPath);

            files.push({
                id: entry.name,
                fileName: entry.name,
                fullPath,
                sourceName: header.source ?? path.parse(entry.name).name,
                createdAt: header.created_at ?? stat.mtime.toISOString(),
                sizeBytes: stat.size,
                durationSec: header.duration_sec,
                language: header.language,
            });
        }

        files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return files;
    }

    private readHeader(filePath: string): TranscriptHeader {
        try {
            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.alloc(512);
            const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
            fs.closeSync(fd);

            const firstLine = buffer.toString('utf8', 0, bytesRead).split('\n')[0];
            const match = firstLine.match(HEADER_PATTERN);
            if (!match) {
                return {};
            }
            return JSON.parse(match[1]) as TranscriptHeader;
        } catch {
            return {};
        }
    }

    async delete(fileName: string): Promise<void> {
        const fullPath = path.join(this.storageDir, fileName);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            this.onChangedEmitter.fire();
        }
    }

    private startWatching(): void {
        if (!fs.existsSync(this.storageDir)) {
            return;
        }
        try {
            this.watcher = fs.watch(this.storageDir, { persistent: false }, (_event, fileName) => {
                if (fileName && fileName.endsWith(TRANSCRIPT_EXTENSION)) {
                    this.onChangedEmitter.fire();
                }
            });
        } catch {
            // Watch failed - fine, panel will refresh on visibility change
        }
    }

    private stopWatching(): void {
        this.watcher?.close();
        this.watcher = null;
    }

    dispose(): void {
        this.stopWatching();
        this.onChangedEmitter.dispose();
    }
}
