import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { VoiceRecord, LogFilter } from './types';

export interface DraftRecord {
    id: string;
    confirmedText: string;
    pendingText: string;
    startedAt: string;
    durationSec: number;
}

export class LogStore implements vscode.Disposable {
    private readonly onRecordAddedEmitter = new vscode.EventEmitter<VoiceRecord>();
    private readonly onRecordUpdatedEmitter = new vscode.EventEmitter<VoiceRecord>();
    private readonly onRecordDeletedEmitter = new vscode.EventEmitter<string>();
    private readonly onDraftChangedEmitter = new vscode.EventEmitter<DraftRecord | null>();

    readonly onRecordAdded = this.onRecordAddedEmitter.event;
    readonly onRecordUpdated = this.onRecordUpdatedEmitter.event;
    readonly onRecordDeleted = this.onRecordDeletedEmitter.event;
    readonly onDraftChanged = this.onDraftChangedEmitter.event;

    private fileWatcher: fs.FSWatcher | null = null;
    private draft: DraftRecord | null = null;

    constructor(public readonly logPath: string) {}

    get currentDraft(): DraftRecord | null {
        return this.draft;
    }

    setDraft(draft: DraftRecord | null): void {
        this.draft = draft;
        this.onDraftChangedEmitter.fire(draft);
    }

    async add(record: VoiceRecord): Promise<void> {
        fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
        const line = JSON.stringify(record) + '\n';
        fs.appendFileSync(this.logPath, line, { encoding: 'utf8', flag: 'a' });
        this.onRecordAddedEmitter.fire(record);
        await this.enforceLimit();
    }

    async get(id: string): Promise<VoiceRecord | null> {
        const records = await this.list();
        return records.find(r => r.id === id) ?? null;
    }

    async update(id: string, updates: Partial<VoiceRecord>): Promise<void> {
        const records = await this.list();
        const index = records.findIndex(r => r.id === id);
        if (index === -1) {
            throw new Error(`Record not found: ${id}`);
        }
        records[index] = { ...records[index], ...updates };
        await this.writeAll(records.slice().reverse());
        this.onRecordUpdatedEmitter.fire(records[index]);
    }

    async delete(id: string): Promise<void> {
        const records = await this.list();
        const filtered = records.filter(r => r.id !== id);
        await this.writeAll(filtered.slice().reverse());
        this.onRecordDeletedEmitter.fire(id);
    }

    async list(filter?: LogFilter): Promise<VoiceRecord[]> {
        if (!fs.existsSync(this.logPath)) {
            return [];
        }

        const content = fs.readFileSync(this.logPath, 'utf8');
        const records: VoiceRecord[] = [];

        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            try {
                records.push(JSON.parse(trimmed) as VoiceRecord);
            } catch {
                // Skip malformed lines
            }
        }

        records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        if (!filter) {
            return records;
        }

        return records.filter(r => {
            if (filter.starred !== undefined && r.starred !== filter.starred) {
                return false;
            }
            if (filter.language && r.language !== filter.language) {
                return false;
            }
            if (filter.since && new Date(r.timestamp) < filter.since) {
                return false;
            }
            if (filter.until && new Date(r.timestamp) > filter.until) {
                return false;
            }
            return true;
        });
    }

    async search(query: string): Promise<VoiceRecord[]> {
        const all = await this.list();
        const q = query.toLowerCase();
        return all.filter(r => r.text.toLowerCase().includes(q));
    }

    async clear(): Promise<void> {
        if (!fs.existsSync(this.logPath)) {
            return;
        }
        const existing = await this.list();
        fs.writeFileSync(this.logPath, '', 'utf8');
        for (const record of existing) {
            this.onRecordDeletedEmitter.fire(record.id);
        }
    }

    async exportMarkdown(): Promise<string> {
        const records = await this.list();
        if (records.length === 0) {
            return '# Voice Log\n\n*No records.*\n';
        }

        const lines = ['# Voice Log\n'];
        let currentDate = '';

        for (const r of records) {
            const d = new Date(r.timestamp);
            const dateStr = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
            if (dateStr !== currentDate) {
                currentDate = dateStr;
                lines.push(`\n## ${dateStr}\n`);
            }
            const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            lines.push(`**${time}** (${r.language}, ${r.duration_sec.toFixed(1)}s)`);
            lines.push(`\n> ${r.text}\n`);
        }

        return lines.join('\n');
    }

    get recordCount(): number {
        if (!fs.existsSync(this.logPath)) {
            return 0;
        }
        const content = fs.readFileSync(this.logPath, 'utf8');
        return content.split('\n').filter(l => l.trim()).length;
    }

    private async enforceLimit(): Promise<void> {
        const config = vscode.workspace.getConfiguration('puthtotalk.log');
        const maxRecords = config.get<number>('maxRecords', 1000);
        const strategy = config.get<string>('onLimitExceeded', 'delete-oldest');

        const records = await this.list(); // newest-first
        if (records.length <= maxRecords) {
            return;
        }

        let toKeep: VoiceRecord[];
        if (strategy === 'delete-oldest') {
            toKeep = records.slice(0, maxRecords);
        } else if (strategy === 'delete-non-starred') {
            const starred = records.filter(r => r.starred);
            const nonStarred = records.filter(r => !r.starred);
            const nonStarredSlotCount = Math.max(0, maxRecords - starred.length);
            toKeep = [...starred, ...nonStarred.slice(0, nonStarredSlotCount)];
        } else {
            return;
        }

        const keptIdSet = new Set(toKeep.map(r => r.id));
        const removedRecords = records.filter(r => !keptIdSet.has(r.id));

        await this.writeAll(toKeep.slice().reverse()); // write oldest-first

        for (const removed of removedRecords) {
            this.onRecordDeletedEmitter.fire(removed.id);
        }
    }

    private async writeAll(records: VoiceRecord[]): Promise<void> {
        // records should be in append order (oldest first)
        const content = records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
        fs.writeFileSync(this.logPath, content, 'utf8');
    }

    dispose(): void {
        this.fileWatcher?.close();
        this.onRecordAddedEmitter.dispose();
        this.onRecordUpdatedEmitter.dispose();
        this.onRecordDeletedEmitter.dispose();
        this.onDraftChangedEmitter.dispose();
    }
}
