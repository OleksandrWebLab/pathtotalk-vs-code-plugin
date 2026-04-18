# Спецификация: VS Code extension для голосового ввода через Whisper

## 1. Контекст и цели

**Задача.** Standalone VS Code extension для голосового ввода текста, с встроенным Whisper-бэкендом на локальных GPU. Работает по принципу "нажал кнопку → говоришь → транскрипт попадает в панель истории → пользователь копирует нужное и вставляет куда хочет".

**Use case.** Диктовка промптов Claude Code (VS Code extension от Anthropic, использует custom webview, не поддерживает штатный VS Code Speech API). Плюс диктовка любого текста для дальнейшей вставки в любые поля.

**Целевое состояние "нажал и работает".**
- Пользователь устанавливает extension из marketplace одной командой
- Первый запуск делает всю настройку автоматически: venv, зависимости, модель Whisper
- Дальше: hotkey → говоришь → отпускаешь → транскрипт появляется в Voice Log панели
- Из панели копируешь нужную запись и вставляешь куда хочешь (Ctrl+V в любое поле)

**Ключевая идея.** Работаем без автоматического clipboard/paste. На Wayland + webview Claude Code автовставка нестабильна. Вместо борьбы с этим — архитектура вокруг **Voice Log**: persistent-истории диктовок с удобным UI для ручного копирования. Это и обход Wayland-проблем, и самостоятельно полезная фича: поиск по истории, копирование старых диктовок, документация диктовок проекта.

**Что НЕ входит в цели MVP.**
- System-wide диктовка (за пределами VS Code)
- TTS (озвучка ответов)
- Post-processing через LLM
- Custom vocabulary
- Автоматическая вставка текста как основной механизм
- Multi-user / cloud sync

---

## 2. Архитектура

### Два компонента в одном extension'е

**TypeScript часть (extension.ts)** — то, что видит VS Code:
- Регистрирует команды и hotkeys
- Управляет жизненным циклом Python-сервера (запуск при активации, kill при деактивации)
- Запись аудио с микрофона (через webview Web Audio API)
- UI: статусбар, Voice Log Webview панель, прогресс-бары, уведомления
- Управление clipboard через `wl-clipboard` (Wayland)
- CRUD для voice-log.jsonl в проекте

**Python часть (bundle внутри extension'а)** — скрытая от пользователя:
- FastAPI сервер на `localhost:<random-free-port>`
- faster-whisper с поддержкой CUDA
- Endpoints: `/transcribe`, `/health`, `/info`, `/reload`, `/shutdown`

### Расположение файлов

**Extension-owned (в globalStorage):**

```
~/.config/Code/User/globalStorage/<publisher>.<extension-name>/
├── python-venv/            # изолированный venv
├── models/                 # модели Whisper
│   ├── large-v3/
│   └── small/
├── server.py               # FastAPI (распаковывается из extension)
├── requirements.txt
├── logs/
│   ├── server.log
│   └── extension.log
└── voice-logs-fallback/    # лог для случаев "без workspace"
    └── _global.jsonl
```

**Project-owned (внутри проекта пользователя):**

```
<workspace-root>/
└── .vscode/
    └── voice-log.jsonl     # история диктовок этого проекта
```

### Системные зависимости

1. **Python 3.10+** — обязательно. Без него — сообщение "Install Python 3.10+ and restart VS Code"
2. **wl-clipboard** — для копирования. Если нет — уведомление с командой установки. Extension работает и без него (лог ведётся), но кнопка Copy переключается в fallback (модальное окно с текстом)

---

## 3. Voice Log — центральная концепция MVP

### Что это

**Voice Log** — persistent-история всех диктовок, сделанных в текущем проекте. Хранится как JSONL-файл в `.vscode/voice-log.jsonl` рядом с настройками VS Code проекта. Отображается в виде Webview-панели (в Activity Bar).

### Структура записи (JSONL)

Каждая строка — один JSON-объект:

```json
{
  "id": "a7f3e2b1-4c5d-6789-abcd-ef1234567890",
  "timestamp": "2026-04-18T14:23:05+00:00",
  "text": "Пожалуйста, объясни как работает миграция HCA на staging-окружении",
  "language": "ru",
  "duration_sec": 6.2,
  "model": "large-v3",
  "starred": false,
  "tags": []
}
```

Поля:
- **id** — UUID для операций (delete, star, copy by id)
- **timestamp** — ISO 8601 с таймзоной
- **text** — транскрипт
- **language** — детектированный язык (`ru`, `uk`, `en`, ...)
- **duration_sec** — длительность исходного аудио
- **model** — модель, которой распознавалось (для анализа качества)
- **starred** — пометка избранного
- **tags** — массив строк, опциональные теги (в MVP не используется в UI, структура заложена)

### Расположение файла

**Основной случай — workspace с одной папкой:**
- Путь: `<workspace-root>/.vscode/voice-log.jsonl`
- Папка `.vscode/` создаётся при необходимости
- Переезжает вместе с проектом при копировании/клонировании

**Multi-root workspace:**
- Лог всегда пишется в `.vscode/` **первой папки** в списке folder'ов workspace
- Уведомление при первой записи: `"Voice log will be stored in <имя первой папки>/.vscode/voice-log.jsonl"`
- В настройках можно переопределить выбор через `voiceExtension.log.multiRootFolder` (indices: 0, 1, 2... или путь)

**Workspace без папки (чистый VS Code):**
- Fallback: `<globalStorage>/voice-logs-fallback/_global.jsonl`
- В статусбаре индикация `(no project)`, чтобы пользователь понимал что лог нелокальный

### .gitignore интеграция

**Поведение по умолчанию — auto-add.** При первой записи в проект:

1. Если в корне workspace есть `.git/` (это git-репозиторий):
   - Проверяем существование `.gitignore`
   - Если нет — создаём
   - Проверяем наличие строки `.vscode/voice-log.jsonl` (или покрывающего паттерна типа `.vscode/` или `*.jsonl`)
   - Если не покрыто — добавляем `.vscode/voice-log.jsonl` в конец `.gitignore`
   - Показываем информационное уведомление:
     > `"Added .vscode/voice-log.jsonl to .gitignore to prevent accidental commits of voice transcripts. You can disable this in settings (voiceExtension.gitignoreBehavior)."`

2. Если нет `.git/` — ничего не делаем (в репо не добавишь)

**Настройка `voiceExtension.gitignoreBehavior`:**
- `auto-add` (default) — добавлять автоматически, показывать уведомление
- `ask` — спрашивать при первой записи ("Add to .gitignore? [Yes / No / Don't ask again]")
- `never` — никогда не трогать .gitignore

**Идемпотентность.** Проверка "строка уже есть в gitignore" учитывает разные паттерны, которые покрывают файл:
- `.vscode/voice-log.jsonl` (точное совпадение)
- `.vscode/` (папка целиком)
- `*.jsonl` (глобальный паттерн)
- `/.vscode/**` (и подобные)

Если любой из них покрывает — ничего не добавляем. Это защищает от дублирования строк при повторных запусках.

### Voice Log UI (Webview Panel)

Панель доступна через:
- Кастомную иконку микрофона в Activity Bar (левый сайдбар)
- Command `Voice: Show Log`
- Hotkey `Ctrl+Shift+L` (настраивается)
- Клик на индикатор в статусбаре "X records"

**Макет:**

```
┌────────────────────────────────────────────────┐
│ Voice Log                          [⚙️] [🗑]   │
│ Project: abcor-crm                             │
│ ┌─────────────────────────────────────────┐    │
│ │ 🔍 Search...                            │    │
│ └─────────────────────────────────────────┘    │
│                                                │
│ Today                                          │
│ ┌────────────────────────────────────────┐     │
│ │ 14:23 · ru · 6.2s                   ⭐  │     │
│ │ Пожалуйста, объясни как работает      │     │
│ │ миграция HCA на staging-окружении...  │     │
│ │ [📋 Copy] [⭐] [🗑]                    │     │
│ └────────────────────────────────────────┘     │
│                                                │
│ ┌────────────────────────────────────────┐     │
│ │ 14:18 · en · 2.1s                       │     │
│ │ Add error handling to this function    │     │
│ │ [📋 Copy] [⭐] [🗑]                    │     │
│ └────────────────────────────────────────┘     │
│                                                │
│ Yesterday                                      │
│ ...                                            │
└────────────────────────────────────────────────┘
```

**Функциональность:**

- **Список записей**, сгруппированы по дням (Today, Yesterday, This Week, Older)
- **Starred section** — закреплённые записи отдельно сверху
- **Поиск** по тексту с подсветкой
- **Кнопка Copy** на каждой записи → `wl-copy` → короткая анимация "Copied!"
- **Star / Unstar** — закрепление
- **Delete** — с подтверждением
- **Bulk operations** — Ctrl+Click для мультивыбора, потом Copy as Merged / Delete Selected
- **Expand/Collapse** длинных записей (>3 строк)
- **Auto-scroll** наверх при появлении новой записи (если панель видна)
- **Context menu** (правый клик): Copy, Copy as Markdown Quote, Star, Edit (in-place редактирование для исправления опечаток Whisper), Delete

**Header:**
- Название проекта (имя первой папки workspace)
- ⚙️ — быстрые настройки (модель, язык, gitignore behavior)
- 🗑 — очистить весь лог (с подтверждением)

### Механизм копирования на Wayland

```typescript
import { spawn } from 'child_process';

async function copyToClipboard(text: string): Promise<void> {
  // Try wl-copy first (preferred on Wayland)
  try {
    await spawnAndWrite('wl-copy', text);
    return;
  } catch (e) {
    // wl-copy not installed or failed
  }
  
  // Fallback to VS Code API (may or may not work on Wayland)
  try {
    await vscode.env.clipboard.writeText(text);
    return;
  } catch (e) {
    // Both failed
  }
  
  // Last resort: show modal with selectable text
  await vscode.window.showInformationMessage(
    'Copy failed. Select text manually:',
    { modal: true, detail: text }
  );
}
```

---

## 4. Пользовательский опыт (UX)

### Первая установка

1. Ставится из marketplace
2. При активации — проверка Python, venv, модели
3. Welcome-нотификация:
   > "Voice extension needs to download ~500MB (Python deps + Whisper large-v3 model). Continue?"
   - **Yes** → скачивание, прогресс в статусбаре
   - **Later** → запрос повторится при первом использовании
4. Проверка `wl-clipboard` — если нет, уведомление с командой установки для Fedora: `sudo dnf install wl-clipboard`

### Первая запись в проекте

При первой диктовке в новом workspace:
1. Проверяем есть ли `.vscode/voice-log.jsonl` — если нет, создаём
2. Проверяем есть ли `.git/` в корне — если да, работает gitignore-логика
3. Показываем уведомление:
   > `"Voice log created at .vscode/voice-log.jsonl and added to .gitignore. [Show File] [Settings]"`

При открытии существующего workspace, где уже есть `voice-log.jsonl` — ничего не делаем, просто работаем с ним.

### Статусбар

```
🎤 Voice: 14              — готов, цифра = записей в логе проекта
⏳ Voice: Loading         — сервер стартует
🔴 Voice: Recording       — идёт запись
💭 Voice: Transcribing    — обработка аудио
⚠️ Voice: Error           — проблема (клик → детали)
⚙️ Voice: Setting up      — первая установка
🎤 Voice (no project)     — fallback-лог, не привязан к workspace
```

Клик — открывает Voice Log панель.

### Основной цикл

**Push-to-talk (по умолчанию):**

1. Зажимаешь `Ctrl+Shift+M` → запись, статусбар → 🔴
2. Говоришь. Индикатор уровня микрофона в статусбаре
3. Отпускаешь → стоп + транскрипция
4. Через 1-3 сек — новая запись в Voice Log
5. Ненавязчивое уведомление: `✓ Transcribed: "Пожалуйста, объясни..."` (truncate 50 символов)

**Toggle:**

1. `Ctrl+Shift+M` → старт (без удержания)
2. `Ctrl+Shift+M` / `Escape` → стоп

### Типичный workflow с Claude Code

1. Открыт Voice Log в Activity Bar слева
2. Открыт Claude Code справа
3. Зажал hotkey → продиктовал промпт → отпустил
4. Запись появилась в Voice Log
5. Кликнул 📋 Copy (или Enter на фокусированной записи)
6. Кликнул в поле Claude Code
7. Ctrl+V — вставка

### Обработка ошибок

- **Permission denied на микрофон** → нотификация с инструкцией для Fedora/PipeWire
- **wl-clipboard не установлен** (при Copy) → уведомление + fallback на модальное окно
- **Сервер упал** → auto-restart (3 попытки за минуту), потом error в статусбаре
- **Whisper вернул пустоту** → запись НЕ добавляется, уведомление "No speech detected"
- **GPU OOM** → fallback на меньшую модель (large-v3 → medium → small)
- **Нет write-permission в .vscode/** → fallback на globalStorage + уведомление

---

## 5. Настройки

### Основные

- **`voiceExtension.model`** — `tiny` | `base` | `small` | `medium` | `large-v3` (default: `large-v3`)
- **`voiceExtension.device`** — `auto` | `cuda:0` | `cuda:1` | `cpu` (default: `auto`)
- **`voiceExtension.language`** — `auto` | `ru` | `uk` | `en` | ... (default: `auto`)
- **`voiceExtension.mode`** — `push-to-talk` (default) | `toggle`

### Voice Log

- **`voiceExtension.log.maxRecords`** — лимит в одном проекте (default: `1000`)
- **`voiceExtension.log.onLimitExceeded`** — `delete-oldest` (default) | `delete-non-starred` | `archive` | `ask`
- **`voiceExtension.log.autoOpenPanel`** — открывать ли панель при старте VS Code (default: `false`)
- **`voiceExtension.log.groupBy`** — `day` (default) | `week` | `none`
- **`voiceExtension.log.showNotificationOnTranscribe`** — toast-уведомление (default: `true`)
- **`voiceExtension.log.multiRootFolder`** — `0` (default, первая папка) | `1` | `2` | ... или абсолютный путь

### .gitignore

- **`voiceExtension.gitignoreBehavior`** — `auto-add` (default) | `ask` | `never`

### Advanced

- **`voiceExtension.computeType`** — `auto` | `float16` | `int8_float16` | `int8` | `float32`
- **`voiceExtension.vadFilter`** — `true` (default)
- **`voiceExtension.beamSize`** — `5` (default), 1-10
- **`voiceExtension.serverPort`** — `0` (auto, default) или число

### Дефолты под GPU (auto-detect)

- **RTX 4070 (12GB)** — `large-v3`, `float16`, beamSize 5
- **GTX 1650 Super (4GB)** — `small`, `int8_float16`, beamSize 5
- **CPU** — `base`, `int8`, beamSize 1

---

## 6. Команды (Command Palette)

**Запись:**
- **Voice: Start Recording**
- **Voice: Stop Recording**

**Voice Log:**
- **Voice: Show Log** — открыть панель
- **Voice: Copy Last Transcription** — copy самой свежей записи
- **Voice: Search Log** — фокус на search
- **Voice: Clear Project Log** — очистить (с подтверждением)
- **Voice: Export Log as Markdown** — сохранить как .md
- **Voice: Open Log File** — открыть `.vscode/voice-log.jsonl` в редакторе для прямого просмотра/редактирования

**.gitignore:**
- **Voice: Add Log to .gitignore** — если решил добавить позже
- **Voice: Remove Log from .gitignore** — если решил коммитить

**Управление:**
- **Voice: Change Model** — quick-pick
- **Voice: Change Language** — quick-pick
- **Voice: Restart Server**
- **Voice: Show Server Logs**
- **Voice: Show Extension Logs**
- **Voice: Download Model** — заранее подготовить
- **Voice: Reset Extension** — удалить venv, модели (с подтверждением)

---

## 7. Python-сервер

### Зависимости (`requirements.txt`)

```
faster-whisper>=1.0.0
fastapi>=0.110.0
uvicorn>=0.27.0
python-multipart>=0.0.9
numpy>=1.24.0
```

### Endpoints

**`GET /health`**
```json
{
  "status": "ready" | "loading" | "error",
  "model": "large-v3",
  "device": "cuda:0",
  "vram_used_mb": 3200,
  "uptime_sec": 145
}
```

**`POST /transcribe`**

Multipart: `audio` (WAV 16kHz mono), `language` (optional), `vad_filter` (optional).

```json
{
  "text": "распознанный текст",
  "language": "ru",
  "duration_sec": 2.3,
  "processing_time_sec": 0.8
}
```

**`POST /reload`** — смена модели/device на лету.

**`GET /info`** — детальная диагностика.

**`POST /shutdown`** — graceful shutdown.

### Запуск и shutdown

Extension вызывает:
```
<globalStorage>/python-venv/bin/python \
  <globalStorage>/server.py \
  --port <auto> \
  --model <from settings> \
  --device <from settings> \
  --compute-type <from settings> \
  --storage-dir <globalStorage>/models
```

Порт выбирается сокетом (port 0), записывается сервером в `<globalStorage>/server.port`, читается extension'ом.

Shutdown при деактивации: `POST /shutdown` (5 сек grace) → `SIGTERM` (3 сек) → `SIGKILL`.

---

## 8. TypeScript часть

### Структура проекта

```
voice-extension/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts
│   ├── server-manager.ts
│   ├── audio-recorder.ts
│   ├── voice-log/
│   │   ├── log-store.ts          # CRUD операций
│   │   ├── log-location.ts       # определение пути к .vscode/voice-log.jsonl
│   │   ├── gitignore-manager.ts  # работа с .gitignore
│   │   ├── panel.ts              # Webview panel
│   │   └── panel-html.ts         # HTML/CSS/JS для webview
│   ├── clipboard.ts
│   ├── status-bar.ts
│   ├── setup-wizard.ts
│   └── api-client.ts
├── python/
│   ├── server.py
│   └── requirements.txt
└── media/
    ├── icons/
    └── webview/
```

### LogStore

```typescript
class LogStore {
  constructor(logPath: string);
  
  async add(record: VoiceRecord): Promise<void>;
  async get(id: string): Promise<VoiceRecord | null>;
  async update(id: string, updates: Partial<VoiceRecord>): Promise<void>;
  async delete(id: string): Promise<void>;
  async list(filter?: LogFilter): Promise<VoiceRecord[]>;
  async search(query: string): Promise<VoiceRecord[]>;
  async clear(): Promise<void>;
  async exportMarkdown(): Promise<string>;
  
  onRecordAdded: EventEmitter<VoiceRecord>;
  onRecordUpdated: EventEmitter<VoiceRecord>;
  onRecordDeleted: EventEmitter<string>;
}
```

### LogLocation

Отвечает за определение "где мой `voice-log.jsonl` для текущего workspace":

```typescript
class LogLocation {
  static resolve(): LogLocationResult {
    const folders = workspace.workspaceFolders;
    
    if (!folders || folders.length === 0) {
      // Нет workspace — fallback
      return {
        type: 'fallback',
        path: path.join(globalStorageDir, 'voice-logs-fallback', '_global.jsonl')
      };
    }
    
    // Multi-root или single: используем настройку multiRootFolder
    const config = workspace.getConfiguration('voiceExtension.log');
    const folderIndex = config.get<number>('multiRootFolder', 0);
    const folder = folders[folderIndex] ?? folders[0];
    
    return {
      type: 'project',
      path: path.join(folder.uri.fsPath, '.vscode', 'voice-log.jsonl'),
      projectName: folder.name
    };
  }
}
```

Результат меняется при:
- `workspace.onDidChangeWorkspaceFolders` — смена/добавление папок
- Смене настройки `multiRootFolder`

При смене — LogStore переинициализируется с новым путём.

### GitignoreManager

```typescript
class GitignoreManager {
  constructor(workspaceRoot: string);
  
  async ensureEntry(pattern: string): Promise<GitignoreResult> {
    // 1. Есть ли .git/ в workspaceRoot?
    if (!await this.hasGitRepo()) {
      return { status: 'no-git' };
    }
    
    // 2. Есть ли .gitignore?
    const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
    let content = '';
    if (await fs.exists(gitignorePath)) {
      content = await fs.readFile(gitignorePath, 'utf8');
    }
    
    // 3. Покрыт ли pattern существующими правилами?
    if (this.isPatternCovered(pattern, content)) {
      return { status: 'already-covered' };
    }
    
    // 4. Добавить
    const newContent = content.trimEnd() + '\n' + pattern + '\n';
    await fs.writeFile(gitignorePath, newContent);
    return { status: 'added' };
  }
  
  private isPatternCovered(target: string, content: string): boolean {
    // Проверка что любой из паттернов покрывает target
    // Поддержка: .vscode/voice-log.jsonl, .vscode/, *.jsonl, /.vscode/**
    // ...
  }
}
```

### Lifecycle

```typescript
export async function activate(context: ExtensionContext) {
  // 1. Setup check
  const setup = new SetupWizard(context);
  if (!await setup.isReady()) {
    await setup.runFirstTimeSetup();
  }
  
  // 2. Check system deps
  await checkSystemDeps();
  
  // 3. Start Python server
  const server = new ServerManager(context);
  await server.start();
  
  // 4. Init LogStore based on current workspace
  let logStore = createLogStoreForCurrentWorkspace();
  
  // 5. Listen for workspace changes
  context.subscriptions.push(
    workspace.onDidChangeWorkspaceFolders(() => {
      logStore = createLogStoreForCurrentWorkspace();
      voiceLogProvider.updateLogStore(logStore);
    })
  );
  
  // 6. Register Voice Log webview
  const voiceLogProvider = new VoiceLogPanel(logStore);
  context.subscriptions.push(
    window.registerWebviewViewProvider('voiceLog', voiceLogProvider)
  );
  
  // 7. Register commands
  context.subscriptions.push(
    commands.registerCommand('voice.startRecording', () => recorder.start()),
    commands.registerCommand('voice.stopRecording', async () => {
      const audio = await recorder.stop();
      const result = await apiClient.transcribe(audio);
      if (result.text) {
        // First-time-in-project logic
        await handleFirstRecordInProject();
        
        // Add to log
        await logStore.add({
          id: generateUUID(),
          timestamp: new Date().toISOString(),
          text: result.text,
          language: result.language,
          duration_sec: result.duration_sec,
          model: currentModel,
          starred: false,
          tags: []
        });
      }
    }),
    // ...
  );
  
  // 8. Status bar
  const statusBar = new StatusBar(server, recorder, logStore);
  context.subscriptions.push(statusBar);
}

async function handleFirstRecordInProject() {
  const logLocation = LogLocation.resolve();
  if (logLocation.type === 'fallback') return;
  
  const workspaceRoot = path.dirname(path.dirname(logLocation.path));
  
  // Ensure .vscode/ exists
  await fs.mkdir(path.dirname(logLocation.path), { recursive: true });
  
  // Handle .gitignore based on setting
  const behavior = workspace.getConfiguration('voiceExtension').get<string>('gitignoreBehavior', 'auto-add');
  
  if (behavior === 'auto-add') {
    const manager = new GitignoreManager(workspaceRoot);
    const result = await manager.ensureEntry('.vscode/voice-log.jsonl');
    
    if (result.status === 'added') {
      vscode.window.showInformationMessage(
        'Added .vscode/voice-log.jsonl to .gitignore to prevent accidental commits of voice transcripts.',
        'Open Settings'
      ).then(choice => {
        if (choice === 'Open Settings') {
          commands.executeCommand('workbench.action.openSettings', 'voiceExtension.gitignoreBehavior');
        }
      });
    }
  } else if (behavior === 'ask') {
    // Ask user
    // ...
  }
}
```

---

## 9. Нефункциональные требования

### Производительность

**RTX 4070 + large-v3:**
- Старт сервера: < 10 сек
- Latency для 5-сек аудио: < 1.5 сек
- Latency для 30-сек аудио: < 5 сек
- VRAM: ~3.5 GB

**GTX 1650 Super + small:**
- Старт: < 5 сек
- Latency для 5-сек: < 1 сек
- VRAM: ~1 GB

**Voice Log:**
- Открытие панели: < 200ms
- Поиск по 1000 записей: < 50ms
- Добавление записи: < 20ms
- Смена workspace: < 100ms (переинициализация LogStore)

### Надёжность

- Auto-restart Python server (3 попытки за минуту)
- Health check каждые 2 секунды
- JSONL append — atomic через `O_APPEND | O_SYNC` или `fs.appendFile` с последующим fsync
- Failed write в .vscode/ (permissions, read-only FS) → fallback на globalStorage + уведомление
- При падении VS Code посреди записи — аудиобуфер теряется (OK для MVP)

### Безопасность

- Python-сервер слушает только `127.0.0.1`
- Endpoint-защита через `X-Extension-Token` (random, генерируется при старте, permissions 600 на файл)
- Аудио не пишется на диск — in-memory
- Voice Log — текст, permissions 644 (пользовательский файл, как остальной код в проекте)
- Системные логи (`server.log`, `extension.log`) не содержат аудио и транскриптов

### Приватность

В README:
- Ничего не уходит в интернет, кроме первого скачивания модели Whisper с HF и pip install
- Вся обработка локально
- Транскрипты хранятся только в `.vscode/voice-log.jsonl` проекта (или globalStorage fallback)
- **Предупреждение**: если пользователь отключит gitignore и запушит — транскрипты могут попасть в публичный репо. Responsibility на пользователе
- Нет телеметрии

### Платформы

**MVP: Linux (Fedora 43+, Ubuntu 24.04+)** под Wayland + PipeWire.

Бэклог: macOS, Windows.

---

## 10. Бэклог (вне MVP)

- **Custom vocabulary** — словарь замен (Abcor, IDPH, TTP, artisan, ...)
- **Context-aware prompt** — передавать Whisper контекст из текущего файла/чата
- **LLM post-processing** — опциональная чистка транскрипта через локальную LLM
- **Tags** — пометить записи тегами, фильтровать по ним
- **Export** — JSON/CSV/Markdown формат
- **Auto-paste** — опциональная попытка авто-вставки с fallback на лог
- **Multi-GPU balancing**
- **TTS**
- **System-wide mode** — через ydotool/xdotool
- **Streaming transcription** — live-результат
- **Voice commands** — "new paragraph", "delete that", "copy" и т.д.
- **Sync между машинами** — через git (лог в проекте = автоматически переносится с проектом)
- **Diff viewer** — если лог в git, показывать историю изменений

---

## 11. Принятые решения

1. **Основной механизм вставки** — Voice Log панель с manual Copy, НЕ auto-paste. Причина: Wayland + webview Claude Code делают auto-paste нестабильным. Manual Copy через `wl-copy` надёжен + даёт persistent историю
2. **Бэкенд** — faster-whisper, не openai-whisper (4x быстрее, меньше VRAM)
3. **Хранилище Voice Log** — `.vscode/voice-log.jsonl` в проекте. Причина: лог переезжает с проектом, виден в explorer, можно коммитить для документирования (если захочется), не теряется при смене машины
4. **Формат** — JSONL, не SQLite. Причина: проще дебажить, append-only быстрый, нет native-зависимостей, человекочитаемый
5. **.gitignore behavior** — `auto-add` по умолчанию с уведомлением. Причина: защита от случайных коммитов конфиденциального контента, но прозрачно и отключаемо
6. **Multi-root workspace** — первая папка. Причина: предсказуемый дефолт, переопределяемый настройкой
7. **Workspace без папки** — fallback в globalStorage. Причина: extension всё равно должен работать, но пользователь видит `(no project)` в статусбаре
8. **Транспорт Extension ↔ Python** — HTTP localhost через FastAPI
9. **Запись аудио** — через webview Web Audio API (без native-модулей)
10. **Clipboard** — `wl-copy` через spawn, fallback на `vscode.env.clipboard.writeText()`, далее на модальное окно
11. **Python требуется на системе** — не бандлим свой
12. **Платформа MVP** — Linux / Fedora / Wayland / PipeWire

---

## 12. Открытые вопросы

1. **Имя extension'а и publisher.** Рабочее название "Voice Extension". Варианты: `local-whisper-voice`, `whispeak`, `voicelog`, `commander-voice` (единый брендинг с SSH-менеджером)

2. **Webview Audio API permissions на Wayland.** Требует проверки в реальной среде до начала реализации. Chromium (VS Code Webview) в теории умеет работать с PipeWire, но бывают нюансы

3. **Редактирование записи (edit).** In-place в панели или открывать в отдельном input box VS Code? В MVP — in-place (удобнее для коротких исправлений опечаток)

4. **Копирование из клавиатуры в панели.** В Webview панели `Ctrl+C` на выделенной записи — должно копировать весь текст записи, или только selected portion? MVP: выделенный текст работает как обычно, без выделения — `Ctrl+C` копирует всю активную запись

5. **Что при удалении файла voice-log.jsonl вручную пользователем.** Extension должен обнаружить через `workspace.createFileSystemWatcher` и перезагрузить пустой LogStore. Edge case, но может встретиться

6. **Shortcut для Copy Last Transcription.** Удобно иметь хоткей без открытия панели. Предлагаю `Ctrl+Shift+Alt+V` — нужно проверить что не конфликтует со стандартными хоткеями

7. **Merge Copy format.** При "Copy as Merged" для multi-select — разделитель между записями? Варианты: двойной newline, пустая строка, horizontal rule `---`, markdown list. MVP: двойной newline, настраиваемо в будущем