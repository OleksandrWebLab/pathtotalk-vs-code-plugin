import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as crypto from 'crypto';

export type ServerStatus = 'stopped' | 'starting' | 'ready' | 'error';

export class ServerManager implements vscode.Disposable {
    private process: cp.ChildProcess | null = null;
    private _status: ServerStatus = 'stopped';
    private _port: number | null = null;
    private _token: string = '';
    private restartCount: number = 0;
    private restartWindowStart: number = 0;
    private healthCheckTimer: NodeJS.Timeout | null = null;
    private healthFailCount: number = 0;
    private readonly healthFailThreshold = 4;
    private oomDetected: boolean = false;
    private isServerOwner: boolean = false;

    private readonly onStatusChangedEmitter = new vscode.EventEmitter<ServerStatus>();
    readonly onStatusChanged = this.onStatusChangedEmitter.event;

    private externalProgressReport: ((line: string) => void) | null = null;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel,
    ) {}

    get status(): ServerStatus {
        return this._status;
    }

    get port(): number | null {
        return this._port;
    }

    get token(): string {
        return this._token;
    }

    async start(): Promise<void> {
        if (this._status === 'starting' || this._status === 'ready') {
            return;
        }

        this.setStatus('starting');

        if (await this.tryAdoptExistingServer()) {
            this.outputChannel.appendLine(`[ServerManager] Adopted existing server on port ${this._port}`);
            this.setStatus('ready');
            this.startHealthCheck();
            return;
        }

        this._token = crypto.randomBytes(32).toString('hex');

        try {
            await this.spawnServer();
            this.startHealthCheck();
        } catch (err) {
            this.outputChannel.appendLine(`[ServerManager] Failed to start: ${err}`);
            this.setStatus('error');
        }
    }

    async stop(): Promise<void> {
        this.stopHealthCheck();

        if (!this.isServerOwner) {
            // Non-owner: just forget the reference, server keeps running for other windows
            this._port = null;
            this._token = '';
            this.setStatus('stopped');
            return;
        }

        // Try graceful shutdown via HTTP
        if (this._port && this._token) {
            try {
                await this.sendShutdown();
                await this.waitForExit(5000);
            } catch {
                // Fall through to SIGTERM
            }
        }

        if (this.process && !this.process.killed) {
            this.process.kill('SIGTERM');
            await this.waitForExit(3000);
        }

        if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
        }

        this.process = null;
        this._port = null;
        this.isServerOwner = false;

        const tokenFile = this.getTokenFilePath();
        if (fs.existsSync(tokenFile)) {
            fs.unlinkSync(tokenFile);
        }

        this.setStatus('stopped');
    }

    async restart(): Promise<void> {
        await this.stop();
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.start();
    }

    private getTokenFilePath(): string {
        return path.join(this.context.globalStorageUri.fsPath, 'server.token');
    }

    private async tryAdoptExistingServer(): Promise<boolean> {
        const storageDir = this.context.globalStorageUri.fsPath;
        const portFile = path.join(storageDir, 'server.port');
        const tokenFile = this.getTokenFilePath();

        if (!fs.existsSync(portFile) || !fs.existsSync(tokenFile)) {
            return false;
        }

        const port = parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10);
        const token = fs.readFileSync(tokenFile, 'utf8').trim();

        if (isNaN(port) || port <= 0 || !token) {
            return false;
        }

        try {
            const response = await fetch(`http://127.0.0.1:${port}/health`, {
                headers: { 'X-Extension-Token': token },
                signal: AbortSignal.timeout(2000),
            });
            if (!response.ok) {
                return false;
            }
            const body = await response.json() as { status: string };
            if (body.status !== 'ready') {
                return false;
            }
        } catch {
            return false;
        }

        this._port = port;
        this._token = token;
        this.isServerOwner = false;
        return true;
    }

    private async spawnServer(): Promise<void> {
        const pythonPath = this.getPythonPath();
        const serverScript = this.getServerScript();
        const storageDir = this.context.globalStorageUri.fsPath;
        const portFile = path.join(storageDir, 'server.port');
        const logFile = path.join(storageDir, 'logs', 'server.log');

        const config = vscode.workspace.getConfiguration('puthtotalk');
        const model = config.get<string>('model', 'large-v3');
        const device = config.get<string>('device', 'auto');
        const computeType = config.get<string>('computeType', 'auto');
        const beamSize = config.get<number>('beamSize', 5);

        // Remove stale port file
        if (fs.existsSync(portFile)) {
            fs.unlinkSync(portFile);
        }

        const args = [
            serverScript,
            '--port', '0',
            '--model', model,
            '--device', device,
            '--compute-type', computeType,
            '--beam-size', String(beamSize),
            '--storage-dir', path.join(storageDir, 'models'),
            '--token', this._token,
            '--port-file', portFile,
            '--log-file', logFile,
        ];

        this.outputChannel.appendLine(`[ServerManager] Starting: ${pythonPath} ${args.slice(0, 6).join(' ')} ...`);

        let progressReport: ((line: string) => void) | null = null;

        this.process = cp.spawn(pythonPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
        });

        const forEachLine = (data: Buffer): void => {
            const raw = data.toString();
            for (const line of raw.split(/[\r\n]+/)) {
                const trimmed = line.trim();
                if (!trimmed) {
                    continue;
                }
                this.outputChannel.appendLine(`[server] ${trimmed}`);
                progressReport?.(trimmed);
                this.externalProgressReport?.(trimmed);
            }
        };

        this.oomDetected = false;

        const detectOom = (line: string): void => {
            if (line.toLowerCase().includes('out of memory')) {
                this.oomDetected = true;
            }
        };

        this.process.stdout?.on('data', (data: Buffer) => forEachLine(data));
        this.process.stderr?.on('data', (data: Buffer) => {
            forEachLine(data);
            for (const line of data.toString().split(/[\r\n]+/)) {
                detectOom(line);
            }
        });

        this.process.on('exit', (code) => {
            this.outputChannel.appendLine(`[ServerManager] Process exited with code ${code}`);
            if (this._status !== 'stopped') {
                this.handleUnexpectedExit();
            }
        });

        try {
            // Wait for port file (up to 60 seconds)
            const port = await this.waitForPortFile(portFile, 60000);
            this._port = port;

            // Wait for /health to return ready with visible progress notification
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `PuthToTalk: Loading model "${model}"...`,
                    cancellable: false,
                },
                async (progress) => {
                    progress.report({ message: 'Waiting for server...' });

                    let lastPercent = 0;
                    const tqdmPattern = /(\d{1,3})%\|[^|]*\|\s*(\S+?)\s*\/\s*(\S+?)(?:\s|\[|$)/;
                    // Bytes: 405M, 3.09G, 462k, 2.67MiB. File counters look like plain integers (2/4).
                    const byteSizePattern = /^\d+(?:\.\d+)?\s*[kKmMgGtT]i?[bB]?$/;

                    progressReport = (line: string): void => {
                        const tqdmMatch = line.match(tqdmPattern);
                        if (tqdmMatch) {
                            const total = tqdmMatch[3];
                            if (!byteSizePattern.test(total)) {
                                return;
                            }
                            const percent = Math.min(100, parseInt(tqdmMatch[1], 10));
                            const current = tqdmMatch[2];
                            const delta = Math.max(0, percent - lastPercent);
                            lastPercent = percent;
                            progress.report({
                                message: `Downloading model: ${percent}% (${current}/${total})`,
                                increment: delta,
                            });
                            return;
                        }

                        if (line.includes('Loading model')) {
                            progress.report({ message: 'Loading model into memory...' });
                        } else if (line.includes('on cuda') || line.includes('on cpu')) {
                            progress.report({ message: 'Model loaded, warming up...' });
                        }
                    };

                    try {
                        // 30 minutes is enough for the 3GB large-v3 model on a slow connection.
                        await this.waitForReady(1800000);
                    } finally {
                        progressReport = null;
                    }
                }
            );
        } catch (err) {
            if (this.process && !this.process.killed) {
                this.outputChannel.appendLine('[ServerManager] Killing child process after startup timeout/error');
                this.process.kill('SIGKILL');
            }
            this.process = null;
            this._port = null;
            throw err;
        }

        this.isServerOwner = true;
        fs.writeFileSync(this.getTokenFilePath(), this._token, 'utf8');

        this.setStatus('ready');
        this.outputChannel.appendLine(`[ServerManager] Ready on port ${this._port}`);
    }

    async runWithModelLoadingProgress<T>(title: string, operation: () => Promise<T>): Promise<T> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title,
                cancellable: false,
            },
            async (progress) => {
                progress.report({ message: 'Starting...' });

                let lastPercent = 0;
                const tqdmPattern = /(\d{1,3})%\|[^|]*\|\s*(\S+?)\s*\/\s*(\S+?)(?:\s|\[|$)/;
                const byteSizePattern = /^\d+(?:\.\d+)?\s*[kKmMgGtT]i?[bB]?$/;

                this.externalProgressReport = (line: string): void => {
                    const tqdmMatch = line.match(tqdmPattern);
                    if (tqdmMatch) {
                        const total = tqdmMatch[3];
                        if (!byteSizePattern.test(total)) {
                            // Not a byte progress (file counter, audio seconds during warmup, etc).
                            return;
                        }
                        const percent = Math.min(100, parseInt(tqdmMatch[1], 10));
                        const current = tqdmMatch[2];
                        const delta = Math.max(0, percent - lastPercent);
                        lastPercent = percent;
                        progress.report({
                            message: `Downloading model: ${percent}% (${current}/${total})`,
                            increment: delta,
                        });
                        return;
                    }
                    if (line.includes('Loading model')) {
                        progress.report({ message: 'Loading model into memory...' });
                    } else if (line.includes('on cuda') || line.includes('on cpu')) {
                        progress.report({ message: 'Model loaded, warming up...' });
                    }
                };

                try {
                    return await operation();
                } finally {
                    this.externalProgressReport = null;
                }
            },
        );
    }

    private async waitForPortFile(portFile: string, timeoutMs: number): Promise<number> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (fs.existsSync(portFile)) {
                const content = fs.readFileSync(portFile, 'utf8').trim();
                const port = parseInt(content, 10);
                if (!isNaN(port) && port > 0) {
                    return port;
                }
            }
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        throw new Error('Timed out waiting for server port file');
    }

    private async waitForReady(timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                const status = await this.fetchHealth();
                if (status === 'ready') {
                    return;
                }
            } catch {
                // Server not up yet
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        throw new Error('Timed out waiting for server to become ready');
    }

    private async fetchHealth(): Promise<string> {
        if (!this._port) {
            throw new Error('No port');
        }
        const response = await fetch(`http://127.0.0.1:${this._port}/health`, {
            headers: { 'X-Extension-Token': this._token },
            signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) {
            throw new Error(`Health check HTTP ${response.status}`);
        }
        const body = await response.json() as { status: string };
        return body.status;
    }

    private startHealthCheck(): void {
        this.healthFailCount = 0;
        this.healthCheckTimer = setInterval(async () => {
            try {
                // Server replied - it is alive regardless of whether it is "ready" or "loading" a model.
                await this.fetchHealth();
                this.healthFailCount = 0;
            } catch {
                if (this._status === 'ready') {
                    this.healthFailCount++;
                    if (this.healthFailCount >= this.healthFailThreshold) {
                        this.outputChannel.appendLine(
                            `[ServerManager] Health check failed ${this.healthFailCount} times, marking error`
                        );
                        this.setStatus('error');
                        if (!this.isServerOwner) {
                            // Owner will respawn; give it a head start then try to adopt
                            this._port = null;
                            this._token = '';
                            setTimeout(() => this.start(), 3000);
                        }
                    }
                }
            }
        }, 2000);
    }

    private stopHealthCheck(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
    }

    private handleUnexpectedExit(): void {
        this.setStatus('error');
        this.process = null;
        this._port = null;

        if (this.oomDetected) {
            this.oomDetected = false;
            this.outputChannel.appendLine('[ServerManager] GPU out of memory - not restarting.');
            vscode.window.showErrorMessage(
                'PuthToTalk: Not enough GPU memory to load the model. Try selecting a smaller model in settings.',
                'Open Settings'
            ).then(choice => {
                if (choice === 'Open Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'puthtotalk.model');
                }
            });
            return;
        }

        const now = Date.now();
        if (now - this.restartWindowStart > 60000) {
            this.restartWindowStart = now;
            this.restartCount = 0;
        }

        this.restartCount++;
        if (this.restartCount <= 3) {
            this.outputChannel.appendLine(
                `[ServerManager] Auto-restarting (attempt ${this.restartCount}/3)...`
            );
            setTimeout(() => this.start(), 2000);
        } else {
            this.outputChannel.appendLine('[ServerManager] Too many restarts, giving up.');
            vscode.window.showErrorMessage(
                'PuthToTalk: Voice server crashed repeatedly. Click to view logs.',
                'Show Logs'
            ).then(choice => {
                if (choice === 'Show Logs') {
                    this.outputChannel.show();
                }
            });
        }
    }

    private async sendShutdown(): Promise<void> {
        await fetch(`http://127.0.0.1:${this._port}/shutdown`, {
            method: 'POST',
            headers: { 'X-Extension-Token': this._token },
            signal: AbortSignal.timeout(3000),
        });
    }

    private waitForExit(timeoutMs: number): Promise<void> {
        return new Promise(resolve => {
            if (!this.process) {
                resolve();
                return;
            }
            const timer = setTimeout(resolve, timeoutMs);
            this.process.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }

    private getPythonPath(): string {
        const storageDir = this.context.globalStorageUri.fsPath;
        return path.join(storageDir, 'python-venv', 'bin', 'python');
    }

    private getServerScript(): string {
        return path.join(this.context.extensionPath, 'python', 'server.py');
    }

    private setStatus(status: ServerStatus): void {
        this._status = status;
        this.onStatusChangedEmitter.fire(status);
    }

    dispose(): void {
        this.stopHealthCheck();
        this.onStatusChangedEmitter.dispose();
        if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
        }
    }
}
