import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

export type RecorderState = 'idle' | 'recording' | 'processing';

export interface RecordingResult {
    wavBuffer: Buffer;
    durationSec: number;
}

/**
 * Records audio via parecord (PipeWire/PulseAudio) or arecord (ALSA fallback).
 * Writes a temp WAV file, reads it on stop, then deletes it.
 */
export class AudioRecorder implements vscode.Disposable {
    private process: cp.ChildProcess | null = null;
    private tempFile: string | null = null;
    private startTime: number = 0;
    private levelTimer: NodeJS.Timeout | null = null;
    private _state: RecorderState = 'idle';

    private readonly onStateChangedEmitter = new vscode.EventEmitter<RecorderState>();
    readonly onStateChanged = this.onStateChangedEmitter.event;

    private readonly onLevelEmitter = new vscode.EventEmitter<number>();
    readonly onLevel = this.onLevelEmitter.event;

    get state(): RecorderState {
        return this._state;
    }

    async start(): Promise<void> {
        if (this._state !== 'idle') {
            return;
        }

        this.tempFile = path.join(
            os.tmpdir(),
            `ptt_${crypto.randomBytes(8).toString('hex')}.wav`
        );

        const recorder = await this.findRecorder();
        const args = this.buildArgs(recorder, this.tempFile);

        this.process = cp.spawn(recorder, args, {
            stdio: ['ignore', 'ignore', 'pipe'],
        });

        this.process.stderr?.on('data', () => {
            // suppress parecord/arecord status output
        });

        this.process.on('error', (err) => {
            this.cleanup();
            vscode.window.showErrorMessage(
                `PuthToTalk: Failed to start recorder (${recorder}): ${err.message}. ` +
                `Install parecord: sudo dnf install pulseaudio-utils`
            );
        });

        this.startTime = Date.now();
        this.setState('recording');
        this.startFakeLevelMonitor();
    }

    async stop(): Promise<RecordingResult> {
        if (this._state !== 'recording' || !this.process || !this.tempFile) {
            throw new Error('Not recording');
        }

        this.stopFakeLevelMonitor();
        this.setState('processing');

        const tempFile = this.tempFile;
        const durationSec = (Date.now() - this.startTime) / 1000;

        await this.stopProcess();

        // Small delay to ensure file is flushed
        await new Promise(resolve => setTimeout(resolve, 100));

        if (!fs.existsSync(tempFile)) {
            this.setState('idle');
            throw new Error('Recording file not found - microphone may not be accessible');
        }

        const wavBuffer = fs.readFileSync(tempFile);
        fs.unlinkSync(tempFile);
        this.tempFile = null;

        this.setState('idle');
        return { wavBuffer, durationSec };
    }

    private async stopProcess(): Promise<void> {
        if (!this.process) {
            return;
        }

        return new Promise(resolve => {
            if (!this.process) {
                resolve();
                return;
            }

            const timer = setTimeout(() => {
                this.process?.kill('SIGKILL');
                resolve();
            }, 3000);

            this.process.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });

            // SIGINT causes parecord/arecord to finalize the WAV header properly
            this.process.kill('SIGINT');
        });
    }

    private async findRecorder(): Promise<string> {
        for (const cmd of ['parecord', 'arecord']) {
            if (await this.commandExists(cmd)) {
                return cmd;
            }
        }
        throw new Error(
            'No audio recorder found. Install parecord: sudo dnf install pulseaudio-utils'
        );
    }

    private buildArgs(recorder: string, outputFile: string): string[] {
        if (recorder === 'parecord') {
            return [
                '--format=s16le',
                '--rate=16000',
                '--channels=1',
                '--file-format=wav',
                outputFile,
            ];
        }
        // arecord (ALSA)
        return [
            '-f', 'S16_LE',
            '-r', '16000',
            '-c', '1',
            outputFile,
        ];
    }

    private commandExists(cmd: string): Promise<boolean> {
        return new Promise(resolve => {
            cp.exec(`which ${cmd}`, err => resolve(!err));
        });
    }

    private startFakeLevelMonitor(): void {
        let tick = 0;
        this.levelTimer = setInterval(() => {
            // Sine-wave pulse so the status bar indicator animates
            const level = 0.3 + 0.3 * Math.sin(tick * 0.4);
            tick++;
            this.onLevelEmitter.fire(level);
        }, 100);
    }

    private stopFakeLevelMonitor(): void {
        if (this.levelTimer) {
            clearInterval(this.levelTimer);
            this.levelTimer = null;
        }
    }

    private cleanup(): void {
        this.stopFakeLevelMonitor();
        if (this.tempFile && fs.existsSync(this.tempFile)) {
            fs.unlinkSync(this.tempFile);
            this.tempFile = null;
        }
        this.process = null;
        this.setState('idle');
    }

    private setState(state: RecorderState): void {
        this._state = state;
        this.onStateChangedEmitter.fire(state);
    }

    dispose(): void {
        this.process?.kill('SIGKILL');
        this.cleanup();
        this.onStateChangedEmitter.dispose();
        this.onLevelEmitter.dispose();
    }
}
