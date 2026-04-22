export interface TranscribeResult {
    text: string;
    language: string;
    durationSec: number;
    processingTimeSec: number;
}

export interface HealthResult {
    status: string;
    model: string;
    device: string;
    uptimeSec: number;
}

export interface TranscribedSegment {
    start: number;
    end: number;
    text: string;
}

export interface FileTranscribeResult {
    segments: TranscribedSegment[];
    language: string;
    durationSec: number;
    processingTimeSec: number;
}

export interface FileTranscribeProgress {
    currentSec: number;
    totalSec: number;
}

export class ApiClient {
    private baseUrl: string = '';
    private token: string = '';

    configure(port: number, token: string): void {
        this.baseUrl = `http://127.0.0.1:${port}`;
        this.token = token;
    }

    async transcribe(
        wavBuffer: Buffer,
        language: string = 'auto',
        vadFilter: boolean = true,
    ): Promise<TranscribeResult> {
        const formData = new FormData();
        const arrayBuffer: ArrayBuffer = wavBuffer.buffer instanceof ArrayBuffer
            ? wavBuffer.buffer.slice(wavBuffer.byteOffset, wavBuffer.byteOffset + wavBuffer.byteLength) as ArrayBuffer
            : new Uint8Array(wavBuffer).buffer;
        const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
        formData.append('audio', blob, 'recording.wav');
        if (language !== 'auto') {
            formData.append('language', language);
        }
        formData.append('vad_filter', String(vadFilter));

        const response = await fetch(`${this.baseUrl}/transcribe`, {
            method: 'POST',
            headers: { 'X-Extension-Token': this.token },
            body: formData,
            signal: AbortSignal.timeout(60000),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Transcribe failed: HTTP ${response.status} - ${text}`);
        }

        const body = await response.json() as {
            text: string;
            language: string;
            duration_sec: number;
            processing_time_sec: number;
        };

        return {
            text: body.text,
            language: body.language,
            durationSec: body.duration_sec,
            processingTimeSec: body.processing_time_sec,
        };
    }

    async transcribeFile(
        filePath: string,
        language: string | null,
        onProgress: (progress: FileTranscribeProgress) => void,
    ): Promise<FileTranscribeResult> {
        const response = await fetch(`${this.baseUrl}/transcribe-file`, {
            method: 'POST',
            headers: {
                'X-Extension-Token': this.token,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ path: filePath, language: language ?? undefined }),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Transcribe-file failed: HTTP ${response.status} - ${text}`);
        }
        if (!response.body) {
            throw new Error('Transcribe-file: no response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult: FileTranscribeResult | null = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) {
                    continue;
                }
                const msg = JSON.parse(trimmed) as
                    | { type: 'progress'; current_sec: number; total_sec: number }
                    | { type: 'result'; segments: TranscribedSegment[]; language: string; duration_sec: number; processing_time_sec: number }
                    | { type: 'error'; message: string };

                if (msg.type === 'progress') {
                    onProgress({ currentSec: msg.current_sec, totalSec: msg.total_sec });
                } else if (msg.type === 'result') {
                    finalResult = {
                        segments: msg.segments,
                        language: msg.language,
                        durationSec: msg.duration_sec,
                        processingTimeSec: msg.processing_time_sec,
                    };
                } else if (msg.type === 'error') {
                    throw new Error(msg.message);
                }
            }
        }

        if (!finalResult) {
            throw new Error('Transcribe-file: stream ended without result');
        }
        return finalResult;
    }

    async health(): Promise<HealthResult> {
        const response = await fetch(`${this.baseUrl}/health`, {
            headers: { 'X-Extension-Token': this.token },
            signal: AbortSignal.timeout(3000),
        });

        if (!response.ok) {
            throw new Error(`Health check failed: HTTP ${response.status}`);
        }

        const body = await response.json() as {
            status: string;
            model: string;
            device: string;
            uptime_sec: number;
        };

        return {
            status: body.status,
            model: body.model,
            device: body.device,
            uptimeSec: body.uptime_sec,
        };
    }

    async reloadModel(
        model: string,
        device: string = 'auto',
        computeType: string = 'auto',
        beamSize: number = 5,
    ): Promise<void> {
        const formData = new FormData();
        formData.append('model', model);
        formData.append('device', device);
        formData.append('compute_type', computeType);
        formData.append('beam_size', String(beamSize));

        const response = await fetch(`${this.baseUrl}/reload`, {
            method: 'POST',
            headers: { 'X-Extension-Token': this.token },
            body: formData,
            signal: AbortSignal.timeout(120000),
        });

        if (!response.ok) {
            throw new Error(`Reload failed: HTTP ${response.status}`);
        }
    }
}
