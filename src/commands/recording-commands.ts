import * as vscode from 'vscode';
import * as crypto from 'crypto';

import { CommandDeps } from './types';
import { VoiceRecord } from '../voice-log/types';
import { ensureGitignoreForFirstRecord } from './gitignore-first-record';

export function registerRecordingCommands(deps: CommandDeps): void {
    const { extensionContext, server, recorder, apiClient, getLogStore, globalStorageDir } = deps;

    extensionContext.subscriptions.push(
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
                await recorder.start();
            } catch (err) {
                await vscode.commands.executeCommand('setContext', 'puthtotalk.isRecording', false);
                vscode.window.showErrorMessage(`Failed to start recording: ${err}`);
            }
        }),

        vscode.commands.registerCommand('puthtotalk.stopRecording', async () => {
            await vscode.commands.executeCommand('setContext', 'puthtotalk.isRecording', false);
            if (recorder.state !== 'recording') {
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
