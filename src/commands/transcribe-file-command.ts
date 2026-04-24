import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { CommandDeps } from './types';
import { LogLocation } from '../voice-log/log-location';
import { TranscriptStore } from '../voice-transcripts/transcript-store';
import {
    formatTimestampForFileName,
    formatTranscriptMarkdown,
    sanitizeFileName,
} from '../voice-transcripts/transcript-formatter';
import { formatDateTime } from '../lib/date-format';
import { buildInitialPrompt, loadVocabulary } from '../voice-log/vocabulary-store';
import { ensureStorageDir } from '../voice-log/storage-readme';

const MEDIA_FILTERS = {
    'Audio / Video': ['mp3', 'mp4', 'mkv', 'webm', 'wav', 'm4a', 'flac', 'ogg', 'mov', 'avi', 'aac', 'opus'],
    'All Files': ['*'],
};

export function registerTranscribeFileCommand(
    deps: CommandDeps,
    transcriptStoreRef: { current: TranscriptStore },
): vscode.Disposable {
    return vscode.commands.registerCommand('puthtotalk.transcribeFile', async () => {
        const { server, apiClient, globalStorageDir, output } = deps;

        if (server.status !== 'ready') {
            vscode.window.showWarningMessage('PuthToTalk: Voice server is not ready yet.');
            return;
        }

        const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Transcribe',
            filters: MEDIA_FILTERS,
            title: 'Select audio or video file to transcribe',
        });
        if (!picked || picked.length === 0) {
            return;
        }
        const sourcePath = picked[0].fsPath;
        const sourceName = path.basename(sourcePath);

        const location = LogLocation.resolve(globalStorageDir);
        ensureStorageDir(location.storageDir);

        const existing = await transcriptStoreRef.current.list();
        const duplicate = existing.find(item => item.sourceName === sourceName);
        if (duplicate) {
            const answer = await vscode.window.showWarningMessage(
                `"${sourceName}" was already transcribed on ${formatDateTime(new Date(duplicate.createdAt))}. Transcribe again?`,
                { modal: true },
                'Transcribe again',
            );
            if (answer !== 'Transcribe again') {
                return;
            }
        }

        const config = vscode.workspace.getConfiguration('puthtotalk');
        const configuredLanguage = config.get<string>('language', 'auto');
        const language = configuredLanguage === 'auto' ? null : configuredLanguage;
        const model = config.get<string>('model', 'large-v3');
        const vocabulary = loadVocabulary(location.storageDir);
        const initialPrompt = buildInitialPrompt(vocabulary);

        const now = new Date();
        const timestamp = formatTimestampForFileName(now);
        const baseName = sanitizeFileName(sourceName);
        const outputFileName = `${timestamp}_${baseName}.md`;
        const outputPath = path.join(location.storageDir, outputFileName);

        try {
            const result = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Transcribing "${sourceName}"...`,
                    cancellable: false,
                },
                async (progress) => {
                    progress.report({ message: 'Starting...' });

                    let lastPercent = 0;
                    return apiClient.transcribeFile(sourcePath, language, (p) => {
                        if (!p.totalSec) {
                            progress.report({ message: `Processed ${p.currentSec.toFixed(0)}s` });
                            return;
                        }
                        const percent = Math.min(100, Math.round((p.currentSec / p.totalSec) * 100));
                        const increment = Math.max(0, percent - lastPercent);
                        lastPercent = percent;
                        progress.report({
                            message: `${percent}% (${formatShortDuration(p.currentSec)} / ${formatShortDuration(p.totalSec)})`,
                            increment,
                        });
                    }, initialPrompt);
                },
            );

            const markdown = formatTranscriptMarkdown(result.segments, {
                source: sourceName,
                createdAt: now.toISOString(),
                durationSec: result.durationSec,
                language: result.language,
                processingTimeSec: result.processingTimeSec,
                model,
            });

            fs.writeFileSync(outputPath, markdown, 'utf8');
            transcriptStoreRef.current.refresh();
            output.appendLine(`[Transcribe] Saved ${outputPath}`);

            const choice = await vscode.window.showInformationMessage(
                `Transcript saved: ${outputFileName}`,
                'Open',
            );
            if (choice === 'Open') {
                const doc = await vscode.workspace.openTextDocument(outputPath);
                await vscode.window.showTextDocument(doc);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            output.appendLine(`[Transcribe] Failed: ${message}`);
            vscode.window.showErrorMessage(`Transcribe failed: ${message}`);
        }
    });
}

function formatShortDuration(seconds: number): string {
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
        return `${h}h${m}m`;
    }
    if (m > 0) {
        return `${m}m${s}s`;
    }
    return `${s}s`;
}
