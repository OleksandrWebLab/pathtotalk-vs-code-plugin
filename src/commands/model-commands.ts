import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { CommandDeps } from './types';
import {
    WHISPER_MODELS,
    LANGUAGE_OPTIONS,
    GLOBAL_STATE_KEYS,
    MODEL_DESCRIPTIONS,
    type WhisperModel,
    type SetupMode,
    type DeviceOption,
} from '../constants';

function isModelDownloaded(modelsDir: string, model: WhisperModel): boolean {
    const modelDir = path.join(modelsDir, `models--Systran--faster-whisper-${model}`);
    // HuggingFace writes refs/main only after every blob is fully downloaded.
    const refsMain = path.join(modelDir, 'refs', 'main');
    if (!fs.existsSync(refsMain)) {
        return false;
    }
    const blobsDir = path.join(modelDir, 'blobs');
    if (fs.existsSync(blobsDir)) {
        const blobs = fs.readdirSync(blobsDir);
        if (blobs.some(f => f.endsWith('.incomplete') || f.endsWith('.tmp') || f.endsWith('.lock'))) {
            return false;
        }
    }
    return true;
}

export function registerModelCommands(deps: CommandDeps): void {
    const { extensionContext, server, apiClient } = deps;
    const modelsDir = path.join(extensionContext.globalStorageUri.fsPath, 'models');

    extensionContext.subscriptions.push(
        vscode.commands.registerCommand('puthtotalk.changeModel', async () => {
            const config = vscode.workspace.getConfiguration('puthtotalk');
            const currentModel = config.get<string>('model', 'large-v3');

            const items: vscode.QuickPickItem[] = WHISPER_MODELS.map(model => {
                const downloaded = isModelDownloaded(modelsDir, model);
                const marks: string[] = [MODEL_DESCRIPTIONS[model].size];
                if (model === currentModel) {
                    marks.push('(current)');
                }
                if (downloaded) {
                    marks.push('✓ downloaded');
                }
                return {
                    label: model,
                    description: marks.join('  '),
                    detail: MODEL_DESCRIPTIONS[model].detail,
                };
            });

            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select Whisper model',
                matchOnDetail: true,
            });
            if (!picked || picked.label === currentModel) {
                return;
            }

            if (server.status !== 'ready') {
                await config.update('model', picked.label, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(
                    `Model set to "${picked.label}". It will be loaded on the next server start.`,
                );
                return;
            }

            try {
                await server.runWithModelLoadingProgress(
                    `Loading model "${picked.label}"...`,
                    () => apiClient.reloadModel(
                        picked.label,
                        config.get<string>('device', 'auto'),
                        config.get<string>('computeType', 'auto'),
                        config.get<number>('beamSize', 5),
                    ),
                );
                await config.update('model', picked.label, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Model changed to "${picked.label}".`);
            } catch (err) {
                vscode.window.showErrorMessage(
                    `Failed to load model "${picked.label}": ${err}. Previous model still active.`,
                );
            }
        }),

        vscode.commands.registerCommand('puthtotalk.changeLanguage', async () => {
            const config = vscode.workspace.getConfiguration('puthtotalk');
            const currentLanguage = config.get<string>('language', 'auto');

            const picked = await vscode.window.showQuickPick(
                LANGUAGE_OPTIONS.map(lang => ({
                    label: lang,
                    description: lang === currentLanguage ? '(current)' : '',
                })),
                { placeHolder: 'Select transcription language' },
            );
            if (!picked) {
                return;
            }
            await config.update('language', picked.label, vscode.ConfigurationTarget.Global);
        }),

        vscode.commands.registerCommand('puthtotalk.changeDevice', async () => {
            const config = vscode.workspace.getConfiguration('puthtotalk');
            const currentDevice = config.get<string>('device', 'auto');
            const setupMode = extensionContext.globalState.get<SetupMode>(
                GLOBAL_STATE_KEYS.setupMode,
                'cpu',
            );

            const items: Array<vscode.QuickPickItem & { value: DeviceOption }> = [
                {
                    label: 'auto',
                    value: 'auto',
                    description: currentDevice === 'auto' ? '(current)' : '',
                    detail: 'CUDA if available, otherwise CPU',
                },
                {
                    label: 'cpu',
                    value: 'cpu',
                    description: currentDevice === 'cpu' ? '(current)' : '',
                    detail: 'Force CPU (slower, works everywhere)',
                },
            ];

            if (setupMode === 'gpu') {
                items.push(
                    {
                        label: 'cuda:0',
                        value: 'cuda:0',
                        description: currentDevice === 'cuda:0' ? '(current)' : '',
                        detail: 'First NVIDIA GPU',
                    },
                    {
                        label: 'cuda:1',
                        value: 'cuda:1',
                        description: currentDevice === 'cuda:1' ? '(current)' : '',
                        detail: 'Second NVIDIA GPU',
                    },
                );
            }

            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: setupMode === 'gpu'
                    ? 'Select compute device'
                    : 'Select compute device (GPU options disabled: CPU-only setup)',
                matchOnDetail: true,
            });

            if (!picked || picked.value === currentDevice) {
                return;
            }

            if (server.status !== 'ready') {
                await config.update('device', picked.value, vscode.ConfigurationTarget.Global);
                return;
            }

            try {
                await server.runWithModelLoadingProgress(
                    `Switching to "${picked.value}"...`,
                    () => apiClient.reloadModel(
                        config.get<string>('model', 'large-v3'),
                        picked.value,
                        config.get<string>('computeType', 'auto'),
                        config.get<number>('beamSize', 5),
                    ),
                );
                await config.update('device', picked.value, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Device changed to "${picked.value}".`);
            } catch (err) {
                vscode.window.showErrorMessage(
                    `Failed to switch device: ${err}. Previous device still active.`,
                );
            }
        }),

        vscode.commands.registerCommand('puthtotalk.downloadModel', async () => {
            const items: vscode.QuickPickItem[] = WHISPER_MODELS.map(model => {
                const downloaded = isModelDownloaded(modelsDir, model);
                const marks = [MODEL_DESCRIPTIONS[model].size];
                if (downloaded) {
                    marks.push('✓ already downloaded');
                }
                return {
                    label: model,
                    description: marks.join('  '),
                    detail: MODEL_DESCRIPTIONS[model].detail,
                };
            });
            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select model to download',
                matchOnDetail: true,
            });
            if (!picked) {
                return;
            }
            if (server.status !== 'ready') {
                vscode.window.showWarningMessage('Voice server is not ready yet.');
                return;
            }

            const config = vscode.workspace.getConfiguration('puthtotalk');
            const currentModel = config.get<string>('model', 'large-v3');
            try {
                await server.runWithModelLoadingProgress(
                    `Downloading model "${picked.label}"...`,
                    () => apiClient.reloadModel(
                        picked.label,
                        config.get<string>('device', 'auto'),
                        config.get<string>('computeType', 'auto'),
                        config.get<number>('beamSize', 5),
                    ),
                );
                if (currentModel !== picked.label) {
                    await server.runWithModelLoadingProgress(
                        `Restoring model "${currentModel}"...`,
                        () => apiClient.reloadModel(
                            currentModel,
                            config.get<string>('device', 'auto'),
                            config.get<string>('computeType', 'auto'),
                            config.get<number>('beamSize', 5),
                        ),
                    );
                }
                vscode.window.showInformationMessage(`Model "${picked.label}" downloaded.`);
            } catch (err) {
                vscode.window.showErrorMessage(`Download failed: ${err}`);
            }
        }),
    );
}
