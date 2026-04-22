export interface TranscriptFile {
    id: string;
    fileName: string;
    fullPath: string;
    sourceName: string;
    createdAt: string;
    sizeBytes: number;
    durationSec?: number;
    language?: string;
}

export interface TranscriptSegment {
    start: number;
    end: number;
    text: string;
}
