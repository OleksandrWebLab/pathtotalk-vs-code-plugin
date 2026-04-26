import * as fs from 'fs';
import * as path from 'path';

const README_FILE = 'README.md';

const README_CONTENT = `# PuthToTalk Project Storage

This folder holds voice input data for one project handled by the [PuthToTalk](https://github.com/OleksandrWebLab/pathtotalk-vs-code-plugin) VS Code extension. It lives inside VS Code's per-extension global storage (\`globalStorageUri\`), not inside the project itself - nothing is committed to git, and the personal vocabulary stays personal.

The folder name follows the pattern \`<workspace-name>-<sha256(workspace-path)[0..16]>\` so each opened workspace gets its own isolated storage. The mapping between a folder and the workspace it belongs to is recorded in \`.meta.json\`.

## Files in this folder

- \`.meta.json\` - workspace path, project name, creation/last-used timestamps. Used by the extension to display human-readable names instead of hashes. Do not delete - the extension will recreate it from the current workspace, but if the folder is opened in another VS Code session you will lose the original mapping.
- \`voice-log.jsonl\` - append-only JSONL log of voice dictations. Each line is a JSON object with \`id\`, \`timestamp\`, \`text\`, \`language\`, \`duration_sec\`, \`model\`, \`starred\`, \`tags\`, \`copied\`. Newest entries are at the bottom of the file.
- \`vocabulary.md\` - project-specific terms that Whisper is biased toward during transcription. One term per line, lines starting with \`#\` are comments, the extension reads up to 150 non-comment lines.
- \`<YYYY-MM-DD_HH-mm-ss>_<name>.md\` - transcript of a single audio/video file (one file per transcription job). Structure:
  - First line: HTML comment with JSON metadata (\`source\`, \`created_at\`, \`duration_sec\`, \`language\`, \`model\`, \`processing_time_sec\`). This comment is machine-parsed - do not remove or modify it.
  - H1 heading with the source file name.
  - \`## Summary\` section (see task below).
  - \`---\` separator.
  - Plain-text meta fields (\`**Duration:**\`, \`**Language:**\`, \`**Model:**\`, \`**Transcribed:**\`).
  - \`[HH:MM:SS]\` timecodes every 60 seconds, followed by the spoken text up to the next timecode.

## Renaming or moving the workspace

The folder is keyed by the absolute path of the workspace. If you rename or move the workspace folder, the extension will create a fresh empty storage for the new path. To carry the history over, copy the contents of the old per-project folder into the new one (use the \`Voice: Open Global Storage Folder\` command to find both).

## AI assistant tasks

If you are an AI assistant asked to work inside this folder, these are the two common jobs:

### 1. Fill the Summary of a transcript

Open the target \`.md\` transcript. Find the \`## Summary\` section - it starts with a placeholder line:

\`\`\`
_No summary yet. Paste yours here or ask an AI to summarize the transcript below._
\`\`\`

Replace that placeholder with a 3-5 bullet summary based on the timestamped segments below the metadata. Keep bullets short, factual, and in the same language as the transcript. Do not modify the HTML comment header, the \`---\` separator, the meta fields, or the timecoded segments. Save the file.

### 2. Update the project vocabulary

Scan \`voice-log.jsonl\` and every transcript \`.md\` in this folder. Extract **project-specific** technical terms that Whisper is likely to mishear: product names, frameworks, libraries, class/module names, domain-specific acronyms, people's names mentioned repeatedly. Exclude common dictionary words in any language.

Open \`vocabulary.md\` and add each new unique term on its own line. Preserve existing lines and \`#\`-comments. Keep the file under 150 non-comment lines (the extension will ignore the rest). Save the file.

## Notes

- Nothing in this folder lives inside the project repository. There is no \`.gitignore\` to maintain.
- The extension re-reads \`vocabulary.md\` on every transcription, so changes take effect immediately.
- The extension watches this folder with \`fs.watch\`, so any change to a \`.md\` summary is reflected in the Voice Transcripts panel on next refresh.
`;

function ensureReadme(storageDir: string): void {
    const filePath = path.join(storageDir, README_FILE);
    if (fs.existsSync(filePath)) {
        return;
    }
    fs.writeFileSync(filePath, README_CONTENT, 'utf8');
}

export function ensureStorageDir(storageDir: string): void {
    fs.mkdirSync(storageDir, { recursive: true });
    ensureReadme(storageDir);
}
