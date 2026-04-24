import * as fs from 'fs';
import * as path from 'path';

import { ensureStorageDir } from './storage-readme';

const VOCABULARY_FILE = 'vocabulary.md';

const VOCABULARY_TEMPLATE = `# Project vocabulary for Whisper

# List technical terms, proper names, and jargon specific to this project - one per line.
# Whisper will be biased toward recognizing these words.
# Lines starting with # are ignored. Keep it under ~150 words (Whisper's context limit).

# Examples (delete and replace with your own):
# Laravel
# Inertia
# TypeScript
# Tailwind
# Kubernetes
`;

const MAX_WORDS = 150;

export function vocabularyPath(storageDir: string): string {
    return path.join(storageDir, VOCABULARY_FILE);
}

export function ensureVocabularyFile(storageDir: string): string {
    ensureStorageDir(storageDir);
    const filePath = vocabularyPath(storageDir);
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, VOCABULARY_TEMPLATE, 'utf8');
    }
    return filePath;
}

export function loadVocabulary(storageDir: string): string[] {
    const filePath = vocabularyPath(storageDir);
    if (!fs.existsSync(filePath)) {
        return [];
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const terms: string[] = [];
    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        terms.push(line);
        if (terms.length >= MAX_WORDS) {
            break;
        }
    }
    return terms;
}

export function buildInitialPrompt(vocabulary: string[]): string | null {
    if (vocabulary.length === 0) {
        return null;
    }
    return `Common terms in this context: ${vocabulary.join(', ')}.`;
}
