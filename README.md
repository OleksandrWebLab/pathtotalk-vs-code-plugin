# PathToTalk — Voice Input for VS Code

Local voice input and media transcription via Whisper. Dictate prompts and text into the Voice Log, or drop an audio/video file and get a timestamped transcript — all through a single local Whisper server.

---

## Disclaimer / Personal License

This extension is a personal pet-project, built for myself and for fun.

### What this is
- An experiment and a way to scratch my own itch for voice input
- Written on a "works for me, good enough" basis
- Never intended as a product

### What this is NOT
- **Supported** — please don't open issues asking for help, I won't respond
- **Open to pull requests** — I don't accept, review or merge them
- **On a roadmap** — there is no roadmap and there won't be one
- **Guaranteed** to be compatible, stable or secure — no guarantees whatsoever
- **Published on the VS Code Marketplace** — no, local `.vsix` only

### What you can do
- Download it, build it, install it for yourself
- Fork it and do whatever you want with it
- Use the code as an example or a starting point for your own extension

### Simple rules
- Works for me — great
- Doesn't work for you — feel free to dig in yourself or fork it
- Want a feature — fork the project, don't ping me

Provided **AS IS**, with no obligations on my side.

---

## Installation

### Option A — Install a prebuilt `.vsix` from GitHub Releases

1. Open the [Releases page](../../releases) and download the latest `pathtotalk-<version>.vsix`
2. Install it into VS Code:
   ```bash
   code --install-extension pathtotalk-<version>.vsix
   ```
   or in VS Code UI: `Extensions` panel → `...` menu → `Install from VSIX...` → pick the file
3. Reload VS Code
4. On first run, the extension will run a setup wizard:
   - Creates a Python virtualenv under the extension's global storage
   - Installs `faster-whisper`, `torch` (CUDA or CPU build, auto-detected), and other deps
   - Downloads the selected Whisper model

### Option B — Build from source

Requires Docker + Docker Compose (no local Node.js / Python needed).

```bash
git clone <your-repo-url> pathtotalk
cd pathtotalk

make install        # install npm deps (inside Docker)
make build          # compile TypeScript + package .vsix
make install-ext    # install the built .vsix into local VS Code
```

Other useful targets:

```bash
make compile        # tsc only
make watch          # tsc in watch mode
make lint           # eslint
make clean          # remove out/ and *.vsix
```

After `make install-ext`, reload VS Code. The first launch triggers the same setup wizard as Option A.

---

## Releasing (maintainer notes)

Requires: `gh` CLI authenticated, git remote `origin` configured.

```bash
make release V=0.1.1
```

The [`tools/release.sh`](tools/release.sh) script will:

1. Validate the working tree is clean and the tag doesn't exist yet
2. Bump `package.json` + `package-lock.json` to the given version (via `npm version`)
3. Run `make clean && make build` to produce `pathtotalk-<version>.vsix`
4. Commit `chore: release vX.Y.Z`, create tag `vX.Y.Z`, push both to `origin`
5. Create a GitHub Release with the `.vsix` attached and auto-generated notes from commits

---

## Usage

Default keybindings:

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+M` | Start / stop recording (toggle) |
| `Ctrl+Alt+M` | Cancel recording — discard audio, no transcription (while recording) |
| `Ctrl+Shift+L` | Open Voice Log |

The `Voice: Recording` status bar item is also clickable — left-click toggles recording on and off. When pressed Stop, the recorder keeps capturing for an extra `pathtotalk.stopDelayMs` milliseconds (default 1s) so the last words aren't cut off.

Available commands (Command Palette → `Voice: ...`):

**Voice Log (short dictation records)**
- `Voice: Start / Stop Recording` (toggle — bound to `Ctrl+Shift+M` and the status bar)
- `Voice: Cancel Recording (discard)` — stop without transcribing (bound to `Ctrl+Alt+M` while recording)
- `Voice: Start Recording` / `Voice: Stop Recording` (explicit, non-toggle variants)
- `Voice: Show Log`
- `Voice: Copy Last Transcription`
- `Voice: Search Log`
- `Voice: Export Log as Markdown`
- `Voice: Open Log File` / `Voice: Clear Project Log`
- `Voice: Edit Project Vocabulary` — open the per-project vocabulary file (custom terms biased into the Whisper prompt)
- `Voice: Change Streaming Mode (off / adaptive / on)` — pick how transcription is delivered (see [Streaming modes](#streaming-modes))

**Voice Transcripts (audio / video file transcription)**
- `Voice: Transcribe File...` — pick an audio or video file, transcribe into a timestamped Markdown file
- `Voice: Show Transcripts` — open the Transcripts panel

**Model / server**
- `Voice: Change Model` — pick a Whisper model (`tiny` … `large-v3`)
- `Voice: Change Language` — pick transcription language or `auto`
- `Voice: Change Compute Device` — `auto` / `cuda:0` / `cuda:1` / `cpu`
- `Voice: Restart Server`, `Voice: Show Server Logs`, `Voice: Show Extension Logs`
- `Voice: Download Model` — pre-download a model without switching to it
- `Voice: Reset Extension` — wipe the Python venv and re-run the setup wizard

**Storage**
- `Voice: Open Project Storage Folder` — reveals the per-project storage directory
- `Voice: Open Global Storage Folder` — reveals the extension's global storage (Python venv, models, fallback logs)

### Streaming modes

Three modes for how the dictation transcript is delivered, chosen via `Voice: Change Streaming Mode (off / adaptive / on)` or the `pathtotalk.streamingMode` setting.

| Mode | When to use | How it works |
|------|-------------|--------------|
| `off` (classic) | Short messages, weak GPU / CPU only | Records → stops → transcribes the whole WAV in a single Whisper pass. Best accuracy on short clips, no GPU pressure during recording. |
| `on` (live) | Long dictation when you want to see text as you speak | Streams raw PCM over WebSocket from the first second; Whisper emits partial confirmed/pending text every few seconds. Requires a CUDA GPU; on CPU it lags behind speech on `medium`+ models. |
| `adaptive` (default recommendation for GPU users) | Mix of short and long messages | Buffers PCM in memory until `pathtotalk.adaptiveStreamingThresholdSec` (default 30s) is reached. Short recordings finish in classic mode (full accuracy). When the threshold is crossed, the buffered head is transcribed in one classic pass, then a live WebSocket session takes over for the remainder, so the final text is "classic head + streaming tail". |

While a streaming or adaptive recording is in progress, the Voice Log shows a pinned draft card with a pulsing dot, a ticking duration timer and the live label (`Recording` while buffering in adaptive, `Live` once Whisper is producing partial text).

### Settings

Open VS Code settings (`Ctrl+,`) and search for `pathtotalk`. Key options:

- `pathtotalk.model` — Whisper model (default `large-v3`)
- `pathtotalk.device` — compute device (`auto` picks CUDA if available, otherwise CPU)
- `pathtotalk.language` — transcription language or `auto`
- `pathtotalk.computeType` — `auto` / `float16` / `int8_float16` / `int8` / `float32`
- `pathtotalk.vadFilter` — enable voice activity detection (default `true`)
- `pathtotalk.beamSize` — beam search size (1–10, default 5)
- `pathtotalk.stopDelayMs` — extra recording time after Stop (ms, default `1000`)
- `pathtotalk.streamingMode` — `off` / `on` / `adaptive` (see [Streaming modes](#streaming-modes), default `off`)
- `pathtotalk.adaptiveStreamingThresholdSec` — when `streamingMode = adaptive`, switch from classic buffering to live transcription after this many seconds (default `30`, range 5–300)
- `pathtotalk.streamingIntervalSec` — how often (seconds) the live transcriber emits a partial result (default `2`)
- `pathtotalk.log.*` — Voice Log behavior (max records, grouping, notifications, gitignore handling)

---

## How it works

- A bundled Python FastAPI server (`python/server.py`) runs `faster-whisper` for transcription
- The extension spawns the server on activation, picks a free port, and talks to it over HTTP for classic transcription and over WebSocket for live (streaming) transcription
- Two sidebar views share the same server:
  - **Voice Log** — records captured by the OS recorder (`parecord` / `arecord`) are sent as WAV (classic mode) or as a raw PCM stream (live / adaptive mode); results are stored line-by-line
  - **Voice Transcripts** — a selected media file is transcribed in a streaming HTTP request that reports progress and returns timestamped segments
- All persistent data lives under the extension's global storage (`globalStorageUri`), per project:
  - `<global-storage>/projects/<project-hash>/voice-log.jsonl` — dictation history for that project (newest-first, `copied` flag clears the "unread" highlight after you copy)
  - `<global-storage>/projects/<project-hash>/transcripts/<YYYY-MM-DD_HH-mm-ss>_<source-name>.md` — one file per transcribed recording, each with a JSON metadata header, summary (duration / language / model) and `[HH:MM:SS]` timestamps every 60s
  - `<global-storage>/projects/<project-hash>/vocabulary.md` — per-project vocabulary biased into the Whisper prompt (edit via `Voice: Edit Project Vocabulary`)
- Workspaces without a folder fall back to a shared `voice-logs-fallback` directory under the same global storage
- Use `Voice: Open Project Storage Folder` / `Voice: Open Global Storage Folder` to reveal the actual paths in your file manager

On first activation, a legacy `.vscode/voice-log.jsonl` and `.vscode/pathtotalk/` directory are auto-migrated into the per-project global storage layout above.

Requirements on the host:

- Docker + Docker Compose (only for building from source)
- Python 3.10+ available as `python3` (the setup wizard uses it to create the venv)
- `ffmpeg` in `PATH` — required only for **Voice: Transcribe File...**, since `faster-whisper` shells out to it for video and non-WAV audio
- Optional: NVIDIA GPU with CUDA for faster transcription (`nvidia-smi` is used to detect it)
