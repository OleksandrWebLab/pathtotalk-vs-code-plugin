export const WHISPER_MODELS = [
    'tiny',
    'base',
    'small',
    'medium',
    'large-v2',
    'large-v3',
] as const;

export type WhisperModel = typeof WHISPER_MODELS[number];

export const DEVICE_OPTIONS = ['auto', 'cuda:0', 'cuda:1', 'cpu'] as const;
export type DeviceOption = typeof DEVICE_OPTIONS[number];

export const LANGUAGE_OPTIONS = ['auto', 'ru', 'uk', 'en', 'de', 'fr', 'es', 'it', 'pl'] as const;
export type LanguageOption = typeof LANGUAGE_OPTIONS[number];

export const COMPUTE_TYPE_OPTIONS = ['auto', 'float16', 'int8_float16', 'int8', 'float32'] as const;
export type ComputeTypeOption = typeof COMPUTE_TYPE_OPTIONS[number];

export type SetupMode = 'gpu' | 'cpu';

export const MODEL_DESCRIPTIONS: Record<WhisperModel, { size: string; detail: string }> = {
    'tiny':     { size: '~75 MB',  detail: 'GPU: ~1 GB VRAM • CPU: ~10x realtime • Accuracy: low — good for testing.' },
    'base':     { size: '~145 MB', detail: 'GPU: ~1 GB VRAM • CPU: ~6x realtime • Accuracy: decent.' },
    'small':    { size: '~465 MB', detail: 'GPU: ~2 GB VRAM • CPU: ~2-3x realtime • Accuracy: good — balanced choice.' },
    'medium':   { size: '~1.5 GB', detail: 'GPU: ~5 GB VRAM • CPU: ~1x realtime (barely keeps up) • Accuracy: high.' },
    'large-v2': { size: '~3 GB',   detail: 'GPU: ~8-10 GB VRAM • CPU: ~0.3x realtime (slower than speech) • Accuracy: very high.' },
    'large-v3': { size: '~3 GB',   detail: 'GPU: ~8-10 GB VRAM • CPU: ~0.3x realtime (slower than speech) • Accuracy: best. Recommended for GPU.' },
};

export const VOICE_LOG_FILE = 'voice-log.jsonl';

export const GLOBAL_STATE_KEYS = {
    setupMode: 'puthtotalk.setupMode',
} as const;
