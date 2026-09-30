# ClefVoice

Private voice typing on macOS. Hold Fn, speak, and release
to transcribe locally with Whisper. The Windows helper is an unfinished prototype
and is not packaged for users yet.

Audio and transcripts stay on your device. Internet is needed to build the app
and download models; transcription does not use a cloud API or require an account.

```
ClefVoice (Architecture)
│
├── 🐹 core/ (Core Engine — Go / whisper.cpp)
│   ├── internal/history/ # Persistent history store (~/.clefvoice/history.json) & stats
│   ├── internal/whisper/ # cgo wrapper around whisper.cpp (Metal GPU on macOS)
│   ├── internal/capture/ # High-performance audio capture (miniaudio, 16 kHz mono f32)
│   ├── internal/vad/     # Voice Activity Detection (VAD) & energy silence trimmer
│   ├── internal/postprocess/ # Thai/English word count, filler removal, capitalization
│   └── cmd/clefd/        # Go Daemon: newline-delimited JSON engine loop
│
├── 🍏 native/macos/ (macOS Shell & Helper — Swift / AppKit)
│   ├── Sources/ClefVoice/
│   │   ├── Core/         # EngineClient (IPC + auto-restart), HotkeyManager, TextInserter
│   │   ├── UI/           # MenuBar Popover + Floating HUD Capsule + WKWebView Dashboard Window
│   │   └── App/          # ClefVoiceApp (@main) + Auto-launch window controller
│   └── Makefile
│
├── 🌐 app/ (Dashboard & UI Layer — Web-based: React 18 + Tailwind CSS + Vite)
│   └── src/              # Dashboard / History / Vocabulary / Audio / Preferences
│
└── 🪟 native/windows/ (Experimental Windows Shell — C# / Win32)
    ├── Program.cs        # System Tray
    ├── HotkeyManager.cs  # Hold-to-talk (low-level keyboard hook)
    ├── TextInserter.cs   # SendInput paste
    └── EngineClient.cs   # Spawns clefd.exe + stdio JSON-RPC
```

---

## How it works

The speech recognition pipeline and data calculations live in the **Go core engine** (`clefd`). The macOS app bundles this engine; the experimental Windows helper does not yet have a packaged engine.

The macOS shell (Swift) manages the global hotkey, floating HUD, menu bar, and text insertion.

```
WKWebView (React Dashboard)  ──[JS Bridge]──▶  Platform Shell (Swift)  ──[JSON lines]──▶  clefd (Go)
                                               (MenuBar/HUD/Hotkey/Insert)               (Audio + VAD + Whisper + History)
```

### Engine Protocol (clefd ↔ Native Shell)

- **Commands (stdin):** `get_config`, `get_state`, `set_config`, `load_model`, `start`, `stop`, `toggle`, `get_history`, `get_stats`, `clear_history`, `delete_history`, `set_history_favorite`, `ping`, `shutdown`.
- **Events (stdout):** `ready`, `status`, `level`, `transcribed`, `history`, `stats`, `model_progress`, `model_loaded`, `error`.

### Web Dashboard Bridge (WKWebView ↔ Native Shell)

The React dashboard is embedded directly into `ClefVoice.app/Contents/Resources/web` and rendered inside a high-performance `WKWebView`. The injected `window.clefVoice.call(method, params)` bridge provides direct access to native and engine operations:
- `getState`, `getSettings`, `updateSettings`
- `getLanguages`, `getModelSizes`, `getHotkeys`
- `checkPermissions`, `requestAccessibility`, `requestMicrophone`, `requestInputMonitoring`
- `loadModel`, `getHistory`, `getStats`, `clearHistory`, `deleteHistoryItem`, `setHistoryFavorite`

---

## Features

- **Local transcription** — The app downloads a Whisper model on first use (unless it is already cached). After that, transcription runs on your device with `whisper.cpp`; audio and transcript data are not uploaded.
- **Local history** — Search Thai and English words together, star favorite transcripts, and copy previous text. History stores up to 1,000 transcripts in plain text in `~/.clefvoice/history.json`, restricted to the current macOS user. Favorites are part of that same retained history, not a separate permanent archive; Clear also removes favorites.
- **Thai & English** — Select Thai for Thai-only dictation or Thai + English for automatic language detection. Custom Vocabulary provides spelling hints for Thai names and technical terms; recognition quality varies with the model and audio.
- **Model selection** — Choose Tiny, Base, Small, or Large V3 Turbo. History records the model and measured time to transcript for new sessions.
- **Dashboard and floating HUD** — The dashboard opens on launch; the HUD shows microphone levels while recording.
- **Text insertion** — After transcription, the app uses the clipboard and `Cmd+V` to insert text into the focused field. If the target app does not accept the paste, copy the transcript from History.
- **Custom Vocabulary & Cleanup** — User-added terms are passed to Whisper as spelling hints; filler words such as `um`, `uh`, `เอ่อ`, and `แบบว่า` can be removed.
- **Hold-to-Talk Hotkey** — Press and hold `🌐 Fn` (or your selected hotkey) to dictate while ClefVoice is running.
- **Optional Auto-stop** — Disabled by default; enable it in Voice & Audio to end dictation after a pause.

---

## Getting Started

### Requirements
- **macOS:** macOS 13.0 (Ventura) or later (Apple Silicon recommended)
- **Node.js:** v18+
- **Go:** 1.26+
- **CMake:** required to build whisper.cpp
- **Xcode Command Line Tools:** `xcode-select --install`

The first build needs internet access to install dependencies and fetch the pinned
whisper.cpp source. On first launch, the app downloads the default Base model
(about 142 MB) from the [whisper.cpp model repository](https://huggingface.co/ggerganov/whisper.cpp)
if it is not cached. Transcription itself runs locally.

### Build & Run

1. **Install frontend dependencies and build the complete application bundle:**
   ```bash
   npm --prefix app ci
   npm run build
   ```

2. **Run ClefVoice:**
   ```bash
   open native/macos/ClefVoice.app
   ```

   If macOS blocks an app you built from this source, first try opening it,
   then go to **System Settings → Privacy & Security → Open Anyway** and confirm.
   For a local build you trust, you can instead remove its quarantine attribute:
   ```bash
   xattr -dr com.apple.quarantine native/macos/ClefVoice.app
   open native/macos/ClefVoice.app
   ```
   For an installed copy, replace the path with `/Applications/ClefVoice.app`.
   Only do this for a build you trust. The command bypasses macOS's first-open
   quarantine check; it does not remove or change the app's code signature.

3. **First-Time Permissions:** Open **Settings → Permissions** in ClefVoice and click **Grant** for Accessibility and Microphone. The app does not start monitoring the keyboard before either Accessibility or Input Monitoring has been granted. Input Monitoring is an optional backup for hotkeys if Accessibility alone does not work on your Mac; request it from the same page only when needed.

4. **Dictate:**
   - Click cursor into any text field (Terminal, Notes, Notion, Browser, IDE).
   - **Hold `🌐 Fn`** (or your selected hotkey), speak your text, and release.
   - Wait for transcription to finish. The app then attempts to paste the text
     into the focused field; use History to copy it if pasting is unavailable.

### Shared app configuration

Edit `app.config.json` for the version, app name, bundle identifier, model catalog,
default model, VAD threshold, and the typing speed used by statistics. Builds
sync these values into React, Go, Swift, package manifests, and the lockfile
automatically. Generated files are committed so direct Go/Swift builds work
without generation; do not edit those files by hand.

After changing the config, you can sync or check it explicitly:

```bash
npm run config:sync
npm run config:check
npm run test:config
```

Commit the config and its synced outputs together. CI rejects stale outputs and
release tags that disagree with the configured version. This build configuration
sets app defaults; existing user settings in `~/.clefvoice/config.json` stay intact.

### Install to Applications folder
```bash
npm run install:mac
```

The local build is signed ad hoc. Rebuilding changes its signature and may require
granting macOS Accessibility and Microphone permissions again. Build and run the
same app copy while testing; `npm run build` updates the copy in `native/macos/`,
while `npm run install:mac` updates `/Applications/ClefVoice.app`.

### Public source repository

This repository provides source code and build instructions. GitHub Actions
checks the macOS build and packages DMG/ZIP artifacts. Version tags also publish
these files as GitHub releases. The Windows job remains commented out until the
helper has a Windows build of `clefd.exe` and a complete package.
The current macOS bundles are signed ad hoc, without Developer ID notarization;
macOS may block first launch. Build from source or use the first-open instructions
above for a downloaded copy you trust.

---

## Model startup and statistics

In Preferences, **Model** selects Tiny (~75 MB), Base (~142 MB), Small (~466 MB),
or Large V3 Turbo (~1.5 GB). Base remains the default. Selecting a model downloads
it if needed; larger models also need more RAM. Compare the same phrases on your
Mac, including Thai names and mixed technical terms, and check both spelling and
History timings.

- The engine prepares the saved model on startup. `ready` means the process can
  accept commands; only `model_loaded` means speech recognition is ready.
- Status moves through `loading` (checking the cached file), `downloading` when
  needed, `loading` (Whisper initialization), and finally `idle`. Download 100%
  alone does not mean initialization is complete.
- Cached files are verified with SHA256. Downloads use temporary files and become
  available only after HTTP, length, and checksum checks succeed. Failed downloads
  can be retried in Preferences. Switching models is disabled while loading,
  recording, or transcribing.
- Estimated WPM = recognized words **before post-processing** × 60 / recorded
  audio seconds, including pauses and silence removed by VAD. Processing time is
  excluded. The dashboard aggregates total spoken words / total audio duration,
  rather than averaging individual session speeds.
- Thai word counts remain approximate (Thai letters and marks / 2.5, rounded up);
  non-Thai tokens in mixed text are added separately. Saved output word counts may
  differ from spoken word counts when filler words are removed.
- New history stores duration and spoken word count. Legacy entries retain their
  original measurements; their duration is inferred from saved words/WPM. Previous
  VAD trimming and any historical shortcut expansion cannot be corrected
  without original audio.
- New sessions also store `model` and `processingSeconds`: time from the engine
  handling stop through capture teardown, VAD, audio cleanup, recognition, and
  text cleanup. It excludes History file writes, paste delivery, and model startup.
  The dashboard averages only sessions that have this measurement; older history
  displays no timing rather than an invented zero.
- `set_history_favorite` takes `id` and `favorite`. Favorites persist in the same
  local history file. Search matches all space-separated terms in any order,
  including mixed Thai/English queries.

### Regression checks

```bash
(cd core && go test ./...)
(cd core && go test -race ./internal/engine ./internal/models ./internal/history ./internal/postprocess)
node --test app/tests/*.test.mjs
npm --prefix app run build
(cd native/macos && swift build)
(cd native/macos && swift test)
```


## License

[MIT License](LICENSE)

Whisper model weights are provided by [OpenAI under the MIT License](https://github.com/openai/whisper/blob/main/LICENSE).
The app downloads converted model files from the [whisper.cpp model repository](https://huggingface.co/ggerganov/whisper.cpp).
