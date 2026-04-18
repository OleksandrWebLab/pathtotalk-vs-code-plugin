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
