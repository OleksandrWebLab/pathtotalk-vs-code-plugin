import { TranscribedSegment } from '../api-client';
import { formatDateTime } from '../lib/date-format';

const TIMESTAMP_INTERVAL_SEC = 60;

export const SUMMARY_PLACEHOLDER =
    '_No summary yet. Paste yours here or ask an AI to summarize the transcript below._';

export interface TranscriptMeta {
    source: string;
    createdAt: string;
    durationSec: number;
    language: string;
    processingTimeSec: number;
    model: string;
}

export function formatTranscriptMarkdown(segments: TranscribedSegment[], meta: TranscriptMeta): string {
    const headerJson = JSON.stringify({
        source: meta.source,
        created_at: meta.createdAt,
        duration_sec: meta.durationSec,
        language: meta.language,
        model: meta.model,
        processing_time_sec: meta.processingTimeSec,
    });

    const lines: string[] = [];
    lines.push(`<!-- puthtotalk:transcript ${headerJson} -->`);
    lines.push(`# ${meta.source}`);
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(SUMMARY_PLACEHOLDER);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`**Duration:** ${formatDuration(meta.durationSec)}  `);
    lines.push(`**Language:** ${meta.language}  `);
    lines.push(`**Model:** ${meta.model}  `);
    lines.push(`**Transcribed:** ${formatDateTime(new Date(meta.createdAt))}`);
    lines.push('');

    let lastTimestamp = -TIMESTAMP_INTERVAL_SEC;

    for (const segment of segments) {
        if (segment.start - lastTimestamp >= TIMESTAMP_INTERVAL_SEC) {
            lines.push('');
            lines.push(`[${formatTime(segment.start)}]`);
            lastTimestamp = segment.start;
        }
        lines.push(segment.text.trim());
    }

    lines.push('');
    return lines.join('\n');
}

export function formatTimestampForFileName(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
    );
}

export function sanitizeFileName(source: string): string {
    return source
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Zа-яА-Я0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        || 'transcript';
}

function formatTime(seconds: number): string {
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatDuration(seconds: number): string {
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
        return `${h}h ${m}m ${s}s`;
    }
    if (m > 0) {
        return `${m}m ${s}s`;
    }
    return `${s}s`;
}
