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
    'tiny':     { size: '~75 MB',  detail: 'Fastest. Low accuracy. Good for testing.' },
    'base':     { size: '~145 MB', detail: 'Fast with decent accuracy.' },
    'small':    { size: '~465 MB', detail: 'Good balance of speed and accuracy.' },
    'medium':   { size: '~1.5 GB', detail: 'High accuracy, moderate speed.' },
    'large-v2': { size: '~3 GB',   detail: 'Very high accuracy.' },
    'large-v3': { size: '~3 GB',   detail: 'Best accuracy. Recommended for GPU.' },
};

export const PUTHTOTALK_STORAGE_DIR = '.vscode/puthtotalk';
export const VOICE_LOG_FILE = 'voice-log.jsonl';
export const VOICE_LOG_GITIGNORE_PATTERN = `${PUTHTOTALK_STORAGE_DIR}/${VOICE_LOG_FILE}`;
export const LEGACY_VOICE_LOG_GITIGNORE_PATTERN = '.vscode/voice-log.jsonl';

export const GLOBAL_STATE_KEYS = {
    setupMode: 'puthtotalk.setupMode',
} as const;
