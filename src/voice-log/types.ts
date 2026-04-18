export interface VoiceRecord {
    id: string;
    timestamp: string;
    text: string;
    language: string;
    duration_sec: number;
    model: string;
    starred: boolean;
    tags: string[];
}

export interface LogFilter {
    starred?: boolean;
    language?: string;
    since?: Date;
    until?: Date;
}
