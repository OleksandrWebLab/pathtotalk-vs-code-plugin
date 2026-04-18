# PuthToTalk — Voice Input for VS Code

Local voice input via Whisper. Dictate prompts and text, copy from the Voice Log.

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

1. Open the [Releases page](../../releases) and download the latest `puthtotalk-<version>.vsix`
2. Install it into VS Code:
   ```bash
   code --install-extension puthtotalk-<version>.vsix
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
git clone <your-repo-url> puthtotalk
cd puthtotalk

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

## Usage

Default keybindings:

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+M` | Start / stop recording (toggle) |
| `Escape` | Stop recording (while recording) |
| `Ctrl+Shift+L` | Open Voice Log |

Available commands (Command Palette → `Voice: ...`):

- `Voice: Start Recording` / `Voice: Stop Recording`
- `Voice: Show Log`
- `Voice: Copy Last Transcription`
- `Voice: Search Log`
- `Voice: Export Log as Markdown`
- `Voice: Change Model` — pick a Whisper model (`tiny` … `large-v3`)
- `Voice: Change Language` — pick transcription language or `auto`
- `Voice: Change Compute Device` — `auto` / `cuda:0` / `cuda:1` / `cpu`
- `Voice: Restart Server`, `Voice: Show Server Logs`, `Voice: Show Extension Logs`
- `Voice: Download Model` — pre-download a model without switching to it
- `Voice: Reset Extension` — wipe the Python venv and re-run the setup wizard

### Settings

Open VS Code settings (`Ctrl+,`) and search for `puthtotalk`. Key options:

- `puthtotalk.model` — Whisper model (default `large-v3`)
- `puthtotalk.device` — compute device (`auto` picks CUDA if available, otherwise CPU)
- `puthtotalk.language` — transcription language or `auto`
- `puthtotalk.computeType` — `auto` / `float16` / `int8_float16` / `int8` / `float32`
- `puthtotalk.vadFilter` — enable voice activity detection (default `true`)
- `puthtotalk.beamSize` — beam search size (1–10, default 5)
- `puthtotalk.log.*` — Voice Log behavior (max records, grouping, notifications, gitignore handling)

---

## How it works

- A bundled Python FastAPI server (`python/server.py`) runs `faster-whisper` for transcription
- The extension spawns the server on activation, picks a free port, and talks to it over HTTP
- Audio is captured in the webview sidebar (`Voice Log` view) and sent to the server as a WAV blob
- Transcriptions are appended to a per-workspace JSONL log (`.vscode/voice-log.jsonl` or global storage for workspaces without a folder)

Requirements on the host:

- Docker + Docker Compose (only for building from source)
- Python 3.10+ available as `python3` (the setup wizard uses it to create the venv)
- Optional: NVIDIA GPU with CUDA for faster transcription (`nvidia-smi` is used to detect it)
