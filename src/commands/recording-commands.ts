import * as vscode from 'vscode';
import * as crypto from 'crypto';

import { CommandDeps } from './types';
import { VoiceRecord } from '../voice-log/types';
import { StreamingSession } from '../api-client';
import { DraftMode, DraftRecord } from '../voice-log/log-store';
import { ProjectStorage } from '../voice-log/project-storage';
import { buildInitialPrompt, loadVocabulary } from '../voice-log/vocabulary-store';
import { ensureStorageDir } from '../voice-log/storage-readme';
import { encodePcmToWav } from '../lib/wav-encoder';

type StreamingModeValue = 'off' | 'on' | 'adaptive';

interface StreamingModeOption {
    value: StreamingModeValue;
    label: string;
    description: string;
    detail: string;
}

const STREAMING_MODE_OPTIONS: StreamingModeOption[] = [
    {
        value: 'off',
        label: 'Off (classic)',
        description: 'Record, stop, then transcribe in one shot',
        detail: 'Best accuracy on short messages. No GPU pressure during recording.',
    },
    {
        value: 'adaptive',
        label: 'Adaptive',
        description: 'Classic on short messages, live on long ones',
        detail: 'Switches to live transcription once recording exceeds the threshold (default 30s). Requires a GPU for the live phase.',
    },
    {
        value: 'on',
        label: 'On (always live)',
        description: 'Live transcription from the first second',
        detail: 'Best with a GPU. On CPU it lags behind speech on medium+ models.',
    },
];

export function registerRecordingCommands(deps: CommandDeps): void {
    const { extensionContext, server, recorder, apiClient, getLogStore, globalStorageDir, output } = deps;

    let streamingSession: StreamingSession | null = null;
    let streamingStartMs: number = 0;
    let streamingDraftId: string = '';
    let streamingFinalText: string = '';
    let streamingLanguage: string = '';

    let adaptiveActive: boolean = false;
    let adaptiveBuffer: Buffer[] = [];
    let adaptiveTimer: NodeJS.Timeout | null = null;
    let adaptiveUpgradePromise: Promise<void> | null = null;
    let adaptiveInitialPrompt: string | null = null;
    let adaptiveIntervalSec: number = 2;
    let adaptiveHeadText: string = '';

    function currentDurationSec(): number {
        return (Date.now() - streamingStartMs) / 1000;
    }

    function clearDraft(): void {
        getLogStore().setDraft(null);
    }

    function publishDraft(mode: DraftMode, confirmed: string, pending: string): void {
        const draft: DraftRecord = {
            id: streamingDraftId,
            mode,
            confirmedText: confirmed,
            pendingText: pending,
            startedAt: new Date(streamingStartMs).toISOString(),
            durationSec: currentDurationSec(),
        };
        getLogStore().setDraft(draft);
    }

    function joinHeadAndTail(head: string, tail: string): string {
        if (!head) {
            return tail;
        }
        if (!tail) {
            return head;
        }
        return head.replace(/\s+$/, '') + ' ' + tail.replace(/^\s+/, '');
    }

    function attachStreamingPartials(session: StreamingSession, headText: string = ''): void {
        let partialCount = 0;
        session.onPartial(partial => {
            partialCount++;
            if (partialCount <= 3 || partialCount % 5 === 0) {
                output.appendLine(
                    `[Streaming] partial #${partialCount}: confirmed="${partial.confirmedText.slice(-60)}", ` +
                    `pending="${partial.pendingText.slice(-60)}"`
                );
            }
            const combinedConfirmed = joinHeadAndTail(headText, partial.confirmedText);
            streamingFinalText = combinedConfirmed;
            publishDraft('live', combinedConfirmed, partial.pendingText);
        });
    }

    async function startStreamingFlow(): Promise<void> {
        const config = vscode.workspace.getConfiguration('puthtotalk');
        const language = config.get<string>('language', 'auto');
        const interval = config.get<number>('streamingIntervalSec', 2);

        const location = ProjectStorage.resolve(globalStorageDir);
        ensureStorageDir(location.storageDir);
        const vocabulary = loadVocabulary(location.storageDir);
        const initialPrompt = buildInitialPrompt(vocabulary);
        if (initialPrompt) {
            output.appendLine(`[Streaming] vocabulary terms: ${vocabulary.length}`);
        }

        output.appendLine(`[Streaming] starting, language=${language}, interval=${interval}s`);

        streamingLanguage = language;
        streamingFinalText = '';
        streamingDraftId = crypto.randomUUID();
        streamingStartMs = Date.now();

        try {
            streamingSession = await apiClient.openTranscribeStream(
                language === 'auto' ? null : language,
                interval,
                initialPrompt,
            );
            output.appendLine('[Streaming] WebSocket opened');
        } catch (err) {
            output.appendLine(`[Streaming] WebSocket open failed: ${err}`);
            streamingSession = null;
            throw err;
        }

        attachStreamingPartials(streamingSession);

        publishDraft('live', '', '');
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

    async function startAdaptiveFlow(): Promise<void> {
        const config = vscode.workspace.getConfiguration('puthtotalk');
        const language = config.get<string>('language', 'auto');
        const thresholdSec = config.get<number>('adaptiveStreamingThresholdSec', 30);
        adaptiveIntervalSec = config.get<number>('streamingIntervalSec', 2);

        const location = ProjectStorage.resolve(globalStorageDir);
        ensureStorageDir(location.storageDir);
        const vocabulary = loadVocabulary(location.storageDir);
        adaptiveInitialPrompt = buildInitialPrompt(vocabulary);
        if (adaptiveInitialPrompt) {
            output.appendLine(`[Adaptive] vocabulary terms: ${vocabulary.length}`);
        }

        output.appendLine(`[Adaptive] starting, language=${language}, threshold=${thresholdSec}s`);

        streamingLanguage = language;
        streamingFinalText = '';
        streamingDraftId = crypto.randomUUID();
        streamingStartMs = Date.now();
        adaptiveActive = true;
        adaptiveBuffer = [];
        adaptiveUpgradePromise = null;
        adaptiveHeadText = '';

        publishDraft('recording', '', '');
        output.appendLine(`[Adaptive] initial recording draft published (id=${streamingDraftId})`);

        let chunkCount = 0;
        try {
            await recorder.startStreaming(chunk => {
                chunkCount++;
                if (chunkCount === 1 || chunkCount % 50 === 0) {
                    output.appendLine(`[Adaptive] audio chunk #${chunkCount}, ${chunk.length} bytes, ws=${streamingSession ? 'open' : 'buffer'}`);
                }
                if (streamingSession) {
                    streamingSession.sendAudio(chunk);
                } else {
                    adaptiveBuffer.push(chunk);
                }
            });
        } catch (err) {
            output.appendLine(`[Adaptive] recorder.startStreaming failed: ${err}`);
            adaptiveActive = false;
            adaptiveBuffer = [];
            clearDraft();
            throw err;
        }

        adaptiveTimer = setTimeout(() => {
            adaptiveTimer = null;
            adaptiveUpgradePromise = upgradeAdaptiveToStreaming().catch(err => {
                output.appendLine(`[Adaptive] upgrade failed: ${err}`);
            });
        }, thresholdSec * 1000);
    }

    async function upgradeAdaptiveToStreaming(): Promise<void> {
        if (!adaptiveActive || streamingSession) {
            return;
        }

        const headChunks = adaptiveBuffer;
        adaptiveBuffer = [];
        output.appendLine(`[Adaptive] threshold reached, transcribing buffered head (${headChunks.length} chunks)`);

        let headText = '';
        if (headChunks.length > 0) {
            const wavBuffer = encodePcmToWav(headChunks);
            const config = vscode.workspace.getConfiguration('puthtotalk');
            try {
                const headResult = await apiClient.transcribe(
                    wavBuffer,
                    streamingLanguage,
                    config.get<boolean>('vadFilter', true),
                    adaptiveInitialPrompt,
                );
                headText = headResult.text.trim();
                output.appendLine(`[Adaptive] head transcribed, length=${headText.length}`);
            } catch (err) {
                output.appendLine(`[Adaptive] head transcribe failed, will fall back to streaming-only: ${err}`);
            }
        }

        if (!adaptiveActive) {
            output.appendLine('[Adaptive] aborted before WS open (adaptive flow ended during head transcribe)');
            adaptiveHeadText = headText;
            return;
        }

        adaptiveHeadText = headText;
        const headPromptTail = headText.slice(-200);
        const wsInitialPrompt = headPromptTail
            ? (adaptiveInitialPrompt ? `${adaptiveInitialPrompt} ${headPromptTail}` : headPromptTail)
            : adaptiveInitialPrompt;

        const session = await apiClient.openTranscribeStream(
            streamingLanguage === 'auto' ? null : streamingLanguage,
            adaptiveIntervalSec,
            wsInitialPrompt,
        );
        output.appendLine('[Adaptive] WebSocket opened');

        attachStreamingPartials(session, headText);

        const lateChunks = adaptiveBuffer;
        adaptiveBuffer = [];
        for (const chunk of lateChunks) {
            session.sendAudio(chunk);
        }
        if (lateChunks.length > 0) {
            output.appendLine(`[Adaptive] flushed ${lateChunks.length} late chunks (recorded during head transcribe) to WS`);
        }

        streamingSession = session;
        streamingFinalText = headText;
        publishDraft('live', headText, '');
    }

    async function finalizeAdaptiveAsClassic(): Promise<void> {
        output.appendLine('[Adaptive] finalize as classic (short message)');

        let stopResult: { durationSec: number };
        try {
            stopResult = await recorder.stopStreaming();
            output.appendLine(`[Adaptive] recorder stopped, duration=${stopResult.durationSec.toFixed(2)}s`);
        } catch (err) {
            output.appendLine(`[Adaptive] recorder stopStreaming error: ${err}`);
            throw err;
        }

        const bufferedChunks = adaptiveBuffer;
        adaptiveBuffer = [];

        if (stopResult.durationSec < 0.3 || bufferedChunks.length === 0) {
            return;
        }

        const wavBuffer = encodePcmToWav(bufferedChunks);
        const config = vscode.workspace.getConfiguration('puthtotalk');

        let transcribeResult;
        try {
            transcribeResult = await apiClient.transcribe(
                wavBuffer,
                config.get<string>('language', 'auto'),
                config.get<boolean>('vadFilter', true),
                adaptiveInitialPrompt,
            );
        } catch (err) {
            vscode.window.showErrorMessage(`Transcription failed: ${err}`);
            return;
        }

        if (!transcribeResult.text.trim()) {
            vscode.window.showInformationMessage('PuthToTalk: No speech detected.');
            return;
        }

        const record: VoiceRecord = {
            id: streamingDraftId,
            timestamp: new Date(streamingStartMs).toISOString(),
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
    }

    async function finalizeStreamingFlow(headText: string = ''): Promise<void> {
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
            const tailText = result.text || '';
            finalText = headText
                ? joinHeadAndTail(headText, tailText)
                : (tailText || finalText);
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

    async function finalizeAdaptiveFlow(): Promise<void> {
        clearAdaptiveTimer();

        if (adaptiveUpgradePromise) {
            await adaptiveUpgradePromise.catch(() => undefined);
        }
        adaptiveUpgradePromise = null;

        const wasUpgraded = streamingSession !== null;
        const headText = adaptiveHeadText;
        adaptiveActive = false;
        adaptiveHeadText = '';

        if (wasUpgraded) {
            await finalizeStreamingFlow(headText);
        } else {
            await finalizeAdaptiveAsClassic();
        }
    }

    function clearAdaptiveTimer(): void {
        if (adaptiveTimer) {
            clearTimeout(adaptiveTimer);
            adaptiveTimer = null;
        }
    }

    async function cancelStreamingFlow(): Promise<void> {
        clearAdaptiveTimer();
        adaptiveActive = false;
        adaptiveBuffer = [];
        adaptiveUpgradePromise = null;
        adaptiveHeadText = '';

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

    function getStreamingMode(): StreamingModeValue {
        const raw = vscode.workspace.getConfiguration('puthtotalk').get<unknown>('streamingMode', 'off');
        if (raw === true) {
            return 'on';
        }
        if (raw === false) {
            return 'off';
        }
        if (raw === 'on' || raw === 'adaptive' || raw === 'off') {
            return raw;
        }
        return 'off';
    }

    extensionContext.subscriptions.push(
        vscode.commands.registerCommand('puthtotalk.toggleStreamingMode', async () => {
            const config = vscode.workspace.getConfiguration('puthtotalk');
            const current = getStreamingMode();

            const items: Array<vscode.QuickPickItem & { value: StreamingModeValue }> =
                STREAMING_MODE_OPTIONS.map(option => ({
                    label: option.value === current ? `$(check) ${option.label}` : `      ${option.label}`,
                    description: option.description,
                    detail: option.detail,
                    value: option.value,
                }));

            const picked = await vscode.window.showQuickPick(items, {
                title: 'PuthToTalk: Streaming Mode',
                placeHolder: `Current: ${STREAMING_MODE_OPTIONS.find(o => o.value === current)?.label ?? current}`,
                matchOnDescription: true,
                matchOnDetail: true,
            });

            if (!picked || picked.value === current) {
                return;
            }

            await config.update('streamingMode', picked.value, vscode.ConfigurationTarget.Global);
            const newLabel = STREAMING_MODE_OPTIONS.find(o => o.value === picked.value)?.label ?? picked.value;
            vscode.window.showInformationMessage(`Streaming mode: ${newLabel}`);
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
            if (streamingSession || adaptiveActive) {
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
                const mode = getStreamingMode();
                if (mode === 'on') {
                    await startStreamingFlow();
                } else if (mode === 'adaptive') {
                    await startAdaptiveFlow();
                } else {
                    await recorder.start();
                }
            } catch (err) {
                await vscode.commands.executeCommand('setContext', 'puthtotalk.isRecording', false);
                streamingSession?.cancel();
                streamingSession = null;
                clearAdaptiveTimer();
                adaptiveActive = false;
                adaptiveBuffer = [];
                clearDraft();
                vscode.window.showErrorMessage(`Failed to start recording: ${err}`);
            }
        }),

        vscode.commands.registerCommand('puthtotalk.stopRecording', async () => {
            await vscode.commands.executeCommand('setContext', 'puthtotalk.isRecording', false);
            if (recorder.state !== 'recording') {
                return;
            }

            if (adaptiveActive) {
                try {
                    await finalizeAdaptiveFlow();
                } catch (err) {
                    vscode.window.showErrorMessage(`Recording failed: ${err}`);
                }
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
            const location = ProjectStorage.resolve(globalStorageDir);
            ensureStorageDir(location.storageDir);
            const vocabulary = loadVocabulary(location.storageDir);
            const initialPrompt = buildInitialPrompt(vocabulary);

            let transcribeResult;
            try {
                transcribeResult = await apiClient.transcribe(
                    result.wavBuffer,
                    config.get<string>('language', 'auto'),
                    config.get<boolean>('vadFilter', true),
                    initialPrompt,
                );
            } catch (err) {
                vscode.window.showErrorMessage(`Transcription failed: ${err}`);
                return;
            }

            if (!transcribeResult.text.trim()) {
                vscode.window.showInformationMessage('PuthToTalk: No speech detected.');
                return;
            }

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
