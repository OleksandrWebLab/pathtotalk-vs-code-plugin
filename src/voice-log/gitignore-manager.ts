import * as fs from 'fs';
import * as path from 'path';

export type GitignoreResult =
    | { status: 'no-git' }
    | { status: 'already-covered' }
    | { status: 'added' };

export class GitignoreManager {
    constructor(private readonly workspaceRoot: string) {}

    hasGitRepo(): boolean {
        return fs.existsSync(path.join(this.workspaceRoot, '.git'));
    }

    isEntryPresent(pattern: string): boolean {
        if (!this.hasGitRepo()) {
            return false;
        }
        const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
        if (!fs.existsSync(gitignorePath)) {
            return false;
        }
        const content = fs.readFileSync(gitignorePath, 'utf8');
        return this.isPatternCovered(pattern, content);
    }

    async ensureEntry(pattern: string): Promise<GitignoreResult> {
        if (!this.hasGitRepo()) {
            return { status: 'no-git' };
        }

        const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
        let content = '';

        if (fs.existsSync(gitignorePath)) {
            content = fs.readFileSync(gitignorePath, 'utf8');
        }

        if (this.isPatternCovered(pattern, content)) {
            return { status: 'already-covered' };
        }

        const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
        fs.writeFileSync(gitignorePath, content + separator + pattern + '\n', 'utf8');
        return { status: 'added' };
    }

    async removeEntry(pattern: string): Promise<void> {
        const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
        if (!fs.existsSync(gitignorePath)) {
            return;
        }

        const content = fs.readFileSync(gitignorePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim() !== pattern);
        fs.writeFileSync(gitignorePath, lines.join('\n'), 'utf8');
    }

    private isPatternCovered(target: string, content: string): boolean {
        const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        const targetParts = target.split('/').filter(Boolean);

        for (const line of lines) {
            if (this.lineCoversTarget(line, target, targetParts)) {
                return true;
            }
        }
        return false;
    }

    private lineCoversTarget(line: string, target: string, targetParts: string[]): boolean {
        if (line === target) {
            return true;
        }

        const normalizedLine = line.replace(/^\//, '').replace(/\/$/, '');
        if (targetParts.length > 1) {
            const dir = targetParts[0] + '/';
            if (line === dir || line === `./${dir}` || normalizedLine === targetParts[0]) {
                return true;
            }
        }

        if (line.startsWith('*.')) {
            const ext = line.slice(1);
            if (target.endsWith(ext)) {
                return true;
            }
        }

        if (line.endsWith('/**')) {
            const prefix = line.slice(0, -3);
            if (target.startsWith(prefix + '/') || target === prefix) {
                return true;
            }
        }

        return false;
    }
}
