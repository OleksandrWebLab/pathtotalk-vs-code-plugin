import * as vscode from 'vscode';

import { formatDate, formatTime } from './date-format';

function currentTimestamp(): string {
    const now = new Date();
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${formatDate(now)} ${formatTime(now)}:${String(now.getSeconds()).padStart(2, '0')}.${ms}`;
}

export function createTimestampedOutputChannel(name: string): vscode.OutputChannel {
    const inner = vscode.window.createOutputChannel(name);

    return new Proxy(inner, {
        get(target, prop) {
            if (prop === 'appendLine') {
                return (message: string): void => {
                    target.appendLine(`${currentTimestamp()} ${message}`);
                };
            }
            if (prop === 'append') {
                return (message: string): void => {
                    target.append(`${currentTimestamp()} ${message}`);
                };
            }
            const value = (target as unknown as Record<string, unknown>)[prop as string];
            if (typeof value === 'function') {
                return value.bind(target);
            }
            return value;
        },
    });
}
