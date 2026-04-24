import * as vscode from 'vscode';
import * as crypto from 'crypto';

import { CommandDeps } from './types';
import { VoiceRecord } from '../voice-log/types';
import { StreamingSession } from '../api-client';
import { DraftRecord } from '../voice-log/log-store';
import { ensureGitignoreForFirstRecord } from './gitignore-first-record';

export function registerRecordingCommands(deps: CommandDeps): void {
    const { extensionContext, server, recorder, apiClient, getLogStore, globalStorageDir, output } = deps;

    let streamingSession: StreamingSession | null = null;
    let streamingStartMs: number = 0;
    let streamingDraftId: string = '';
    let streamingFinalText: string = '';
    let streamingLanguage: string = '';

    function currentDurationSec(): number {
        return (Date.now() - streamingStartMs) / 1000;
    }

    function clearDraft(): void {
        getLogStore().setDraft(null);
    }

    function publishDraft(confirmed: string, pending: string): void {
        const draft: DraftRecord = {
            id: streamingDraftId,
            confirmedText: confirmed,
            pendingText: pending,
            startedAt: new Date(streamingStartMs).toISOString(),
            durationSec: currentDurationSec(),
        };
        getLogStore().setDraft(draft);
    }

    async function startStreamingFlow(): Promise<void> {
        const config = vscode.workspace.getConfiguration('puthtotalk');
        const language = config.get<string>('language', 'auto');
        const interval = config.get<number>('streamingIntervalSec', 2);

        output.appendLine(`[Streaming] starting, language=${language}, interval=${interval}s`);

        streamingLanguage = language;
        streamingFinalText = '';
        streamingDraftId = crypto.randomUUID();
        streamingStartMs = Date.now();

        try {
            streamingSession = await apiClient.openTranscribeStream(
                language === 'auto' ? null : language,
                interval,
            );
            output.appendLine('[Streaming] WebSocket opened');
        } catch (err) {
            output.appendLine(`[Streaming] WebSocket open failed: ${err}`);
            streamingSession = null;
            throw err;
        }

        let partialCount = 0;
        streamingSession.onPartial(partial => {
            partialCount++;
            if (partialCount <= 3 || partialCount % 5 === 0) {
                output.appendLine(
                    `[Streaming] partial #${partialCount}: confirmed="${partial.confirmedText.slice(-60)}", ` +
                    `pending="${partial.pendingText.slice(-60)}"`
                );
            }
            streamingFinalText = partial.confirmedText;
            publishDraft(partial.confirmedText, partial.pendingText);
        });

        publishDraft('', '');
        output.appendLine(`[Streaming] initial draft published (id=${streamingDraftId})`);

        let chunkCount = 0;
        try {
            await recorder.startStreaming(chunk => {
                chunkCount++;
                if (chunkCount === 1 || chunkCount % 20 === 0) {
                    output.appendLine(`[Streaming] audio chunk #${chunkCount}, ${chunk.length} bytes`);
                }
                streamingSession?.sendAudio(chunk);
            });
        } catch (err) {
            output.appendLine(`[Streaming] recorder.startStreaming failed: ${err}`);
            streamingSession?.cancel();
            streamingSession = null;
            clearDraft();
            throw err;
        }
        output.appendLine('[Streaming] recorder started, piping PCM to WS');
    }

    async function finalizeStreamingFlow(): Promise<void> {
        const session = streamingSession;
        if (!session) {
            return;
        }
        output.appendLine('[Streaming] finalize requested');

        let stopResult: { durationSec: number };
        try {
            stopResult = await recorder.stopStreaming();
            output.appendLine(`[Streaming] recorder stopped, duration=${stopResult.durationSec.toFixed(2)}s`);
        } catch (err) {
            output.appendLine(`[Streaming] recorder stopStreaming error: ${err}`);
            session.cancel();
            streamingSession = null;
            clearDraft();
            throw err;
        }

        let finalText = streamingFinalText;
        try {
            const result = await session.finalize();
            finalText = result.text || finalText;
            output.appendLine(`[Streaming] final text length=${finalText.length}`);
        } catch (err) {
            output.appendLine(`[Streaming] finalize error: ${err}`);
        }

        streamingSession = null;
        clearDraft();

        const trimmed = finalText.trim();
        if (stopResult.durationSec < 0.3 || !trimmed) {
            return;
        }

        await ensureGitignoreForFirstRecord(globalStorageDir);

        const config = vscode.workspace.getConfiguration('puthtotalk');
        const record: VoiceRecord = {
            id: streamingDraftId,
            timestamp: new Date(streamingStartMs).toISOString(),
            text: trimmed,
            language: streamingLanguage,
            duration_sec: stopResult.durationSec,
            model: config.get<string>('model', 'large-v3'),
            starred: false,
            tags: [],
            copied: false,
        };

        await getLogStore().add(record);

        const showNotification = vscode.workspace
            .getConfiguration('puthtotalk.log')
            .get<boolean>('showNotificationOnTranscribe', true);
        if (showNotification) {
            const previewLimit = 50;
            const preview = trimmed.slice(0, previewLimit) + (trimmed.length > previewLimit ? '...' : '');
            vscode.window.showInformationMessage(`Transcribed: "${preview}"`);
        }
    }

    async function cancelStreamingFlow(): Promise<void> {
        if (streamingSession) {
            streamingSession.cancel();
            streamingSession = null;
        }
        if (recorder.state === 'recording' || recorder.state === 'finishing') {
            try {
                await recorder.cancel();
            } catch {
                // already stopped
            }
        }
        clearDraft();
    }

    function isStreamingMode(): boolean {
        return vscode.workspace.getConfiguration('puthtotalk').get<boolean>('streamingMode', false);
    }

    extensionContext.subscriptions.push(
        vscode.commands.registerCommand('puthtotalk.toggleStreamingMode', async () => {
            const config = vscode.workspace.getConfiguration('puthtotalk');
            const current = config.get<boolean>('streamingMode', false);
            await config.update('streamingMode', !current, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(
                `Streaming transcription: ${!current ? 'ON' : 'OFF'}`,
            );
        }),

        vscode.commands.registerCommand('puthtotalk.toggleRecording', async () => {
            if (recorder.state === 'recording') {
                await vscode.commands.executeCommand('puthtotalk.stopRecording');
                return;
            }
            if (recorder.state === 'idle') {
                await vscode.commands.executeCommand('puthtotalk.startRecording');
            }
        }),

        vscode.commands.registerCommand('puthtotalk.cancelRecording', async () => {
            await vscode.commands.executeCommand('setContext', 'puthtotalk.isRecording', false);
            if (recorder.state !== 'recording' && recorder.state !== 'finishing') {
                return;
            }
            if (streamingSession) {
                await cancelStreamingFlow();
            } else {
                await recorder.cancel();
            }
        }),

        vscode.commands.registerCommand('puthtotalk.startRecording', async () => {
            if (server.status !== 'ready') {
                vscode.window.showWarningMessage('PuthToTalk: Server is not ready yet.');
                return;
            }
            if (recorder.state !== 'idle') {
                return;
            }
            await vscode.commands.executeCommand('setContext', 'puthtotalk.isRecording', true);
            try {
                if (isStreamingMode()) {
                    await startStreamingFlow();
                } else {
                    await recorder.start();
                }
            } catch (err) {
                await vscode.commands.executeCommand('setContext', 'puthtotalk.isRecording', false);
                streamingSession?.cancel();
                streamingSession = null;
                clearDraft();
                vscode.window.showErrorMessage(`Failed to start recording: ${err}`);
            }
        }),

        vscode.commands.registerCommand('puthtotalk.stopRecording', async () => {
            await vscode.commands.executeCommand('setContext', 'puthtotalk.isRecording', false);
            if (recorder.state !== 'recording') {
                return;
            }

            if (streamingSession) {
                try {
                    await finalizeStreamingFlow();
                } catch (err) {
                    vscode.window.showErrorMessage(`Recording failed: ${err}`);
                }
                return;
            }

            let result;
            try {
                result = await recorder.stop();
            } catch (err) {
                vscode.window.showErrorMessage(`Recording failed: ${err}`);
                return;
            }

            if (!result || result.durationSec < 0.3) {
                return;
            }

            const config = vscode.workspace.getConfiguration('puthtotalk');
            let transcribeResult;
            try {
                transcribeResult = await apiClient.transcribe(
                    result.wavBuffer,
                    config.get<string>('language', 'auto'),
                    config.get<boolean>('vadFilter', true),
                );
            } catch (err) {
                vscode.window.showErrorMessage(`Transcription failed: ${err}`);
                return;
            }

            if (!transcribeResult.text.trim()) {
                vscode.window.showInformationMessage('PuthToTalk: No speech detected.');
                return;
            }

            await ensureGitignoreForFirstRecord(globalStorageDir);

            const record: VoiceRecord = {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                text: transcribeResult.text,
                language: transcribeResult.language,
                duration_sec: transcribeResult.durationSec,
                model: config.get<string>('model', 'large-v3'),
                starred: false,
                tags: [],
                copied: false,
            };

            await getLogStore().add(record);

            const showNotification = vscode.workspace
                .getConfiguration('puthtotalk.log')
                .get<boolean>('showNotificationOnTranscribe', true);

            if (showNotification) {
                const previewLimit = 50;
                const preview = transcribeResult.text.slice(0, previewLimit) +
                    (transcribeResult.text.length > previewLimit ? '...' : '');
                vscode.window.showInformationMessage(`Transcribed: "${preview}"`);
            }
        }),
    );
}
