const pad = (value: number): string => String(value).padStart(2, '0');

export function formatDate(date: Date): string {
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function formatTime(date: Date): string {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDateTime(date: Date): string {
    return `${formatDate(date)} ${formatTime(date)}`;
}
