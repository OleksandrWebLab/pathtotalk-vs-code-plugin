import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { TranscriptFile } from './types';
import { SUMMARY_PLACEHOLDER } from './transcript-formatter';

const TRANSCRIPT_EXTENSION = '.md';
const HEADER_PATTERN = /^<!--\s*puthtotalk:transcript\s+(\{.*\})\s*-->/;
const SUMMARY_SECTION_PATTERN = /^##\s+Summary\s*$/m;
const PREAMBLE_BYTES = 4096;
const NON_TRANSCRIPT_FILES = new Set(['README.md', 'vocabulary.md']);

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

    refresh(): void {
        if (!this.watcher) {
            this.startWatching();
        }
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
            if (NON_TRANSCRIPT_FILES.has(entry.name)) {
                continue;
            }

            const fullPath = path.join(this.storageDir, entry.name);
            const stat = fs.statSync(fullPath);
            const preamble = this.readPreamble(fullPath);
            const header = this.parseHeader(preamble);
            const summary = this.parseSummary(preamble);

            files.push({
                id: entry.name,
                fileName: entry.name,
                fullPath,
                sourceName: header.source ?? path.parse(entry.name).name,
                createdAt: header.created_at ?? stat.mtime.toISOString(),
                sizeBytes: stat.size,
                durationSec: header.duration_sec,
                language: header.language,
                summary,
            });
        }

        files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return files;
    }

    private readPreamble(filePath: string): string {
        try {
            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.alloc(PREAMBLE_BYTES);
            const bytesRead = fs.readSync(fd, buffer, 0, PREAMBLE_BYTES, 0);
            fs.closeSync(fd);
            return buffer.toString('utf8', 0, bytesRead);
        } catch {
            return '';
        }
    }

    private parseHeader(preamble: string): TranscriptHeader {
        const firstLine = preamble.split('\n', 1)[0];
        const match = firstLine.match(HEADER_PATTERN);
        if (!match) {
            return {};
        }
        try {
            return JSON.parse(match[1]) as TranscriptHeader;
        } catch {
            return {};
        }
    }

    private parseSummary(preamble: string): string | undefined {
        const match = preamble.match(SUMMARY_SECTION_PATTERN);
        if (!match || match.index === undefined) {
            return undefined;
        }
        const afterHeading = preamble.slice(match.index + match[0].length);
        const stopIndex = afterHeading.search(/\n---\s*\n|\n##\s+|\n\*\*[A-Za-z]/);
        const body = (stopIndex === -1 ? afterHeading : afterHeading.slice(0, stopIndex)).trim();
        if (!body || body === SUMMARY_PLACEHOLDER) {
            return undefined;
        }
        return body;
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
