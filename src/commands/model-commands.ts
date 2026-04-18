import * as vscode from 'vscode';

import { CommandDeps } from './types';
import {
    WHISPER_MODELS,
    LANGUAGE_OPTIONS,
    GLOBAL_STATE_KEYS,
    MODEL_DESCRIPTIONS,
    type SetupMode,
    type DeviceOption,
} from '../constants';

export function registerModelCommands(deps: CommandDeps): void {
    const { extensionContext, server, apiClient } = deps;

    extensionContext.subscriptions.push(
        vscode.commands.registerCommand('puthtotalk.changeModel', async () => {
            const config = vscode.workspace.getConfiguration('puthtotalk');
            const currentModel = config.get<string>('model', 'large-v3');

            const items: vscode.QuickPickItem[] = WHISPER_MODELS.map(model => ({
                label: model,
                description: MODEL_DESCRIPTIONS[model].size + (model === currentModel ? '  (current)' : ''),
                detail: MODEL_DESCRIPTIONS[model].detail,
            }));

            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select Whisper model',
                matchOnDetail: true,
            });
            if (!picked) {
                return;
            }

            await config.update('model', picked.label, vscode.ConfigurationTarget.Global);
            if (server.status === 'ready') {
                await reloadModelFromConfig(apiClient);
                vscode.window.showInformationMessage(`Model changed to "${picked.label}".`);
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

            if (!picked) {
                return;
            }

            await config.update('device', picked.value, vscode.ConfigurationTarget.Global);
            if (server.status === 'ready') {
                try {
                    await reloadModelFromConfig(apiClient);
                    vscode.window.showInformationMessage(`Device changed to "${picked.value}".`);
                } catch (err) {
                    vscode.window.showErrorMessage(
                        `Failed to switch device: ${err}. Check server logs.`,
                    );
                }
            }
        }),

        vscode.commands.registerCommand('puthtotalk.downloadModel', async () => {
            const picked = await vscode.window.showQuickPick([...WHISPER_MODELS], {
                placeHolder: 'Select model to download',
            });
            if (!picked) {
                return;
            }
            await vscode.workspace.getConfiguration('puthtotalk')
                .update('model', picked, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(
                `Model "${picked}" will be downloaded on next server start with this model selected.`,
            );
        }),
    );
}

async function reloadModelFromConfig(apiClient: { reloadModel: (m: string, d: string, c: string, b: number) => Promise<void> }): Promise<void> {
    const config = vscode.workspace.getConfiguration('puthtotalk');
    await apiClient.reloadModel(
        config.get<string>('model', 'large-v3'),
        config.get<string>('device', 'auto'),
        config.get<string>('computeType', 'auto'),
        config.get<number>('beamSize', 5),
    );
}
