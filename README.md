# ClefVoice

Private, local voice typing on macOS. Hold Fn, speak, and release
to transcribe locally with Whisper. The Windows helper is an unfinished prototype
and is not packaged for users yet.

ClefVoice processes audio on your Mac without a cloud transcription API, account,
or subscription. Recordings are held in memory during dictation; saved text history
stays in `~/.clefvoice/history.json`. Internet is needed to build the app and download
models. Once text is pasted, the destination app's sync settings apply; macOS
Universal Clipboard or clipboard managers may also copy text elsewhere.

## Try it

Download a macOS build from [Releases](https://github.com/lalkai/clef-voice/releases),
or follow [Build & Run](#build--run) below. New packages include their architecture
in the filename: `arm64` is for Apple Silicon, `x86_64` is for Intel. A build contains
one architecture, not a universal binary; older releases may omit this label.
For a downloaded build, unzip it (or open the DMG), drag `ClefVoice.app` into
Applications, then open that copy.

This is an early-stage project. Bundles are signed ad hoc and **not notarized**,
so read the first-open instructions below before installing. On first launch,
grant Microphone and Accessibility, then choose a model to download and use.
Models download only when you request them.

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
│   └── src/              # Dashboard / History / Vocabulary / Models / Audio / Preferences
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

- **Commands (stdin):** `get_config`, `get_state`, `set_config`, `get_models`, `download_model`, `delete_model`, `load_model`, `cancel_download`, `start`, `stop`, `toggle`, `get_history`, `get_stats`, `clear_history`, `delete_history`, `set_history_favorite`, `ping`, `shutdown`.
- **Events (stdout):** `ready`, `status`, `level`, `transcribed`, `history`, `stats`, `model_progress`, `model_loaded`, `models`, `config`, `error`, `command_result`.

### Web Dashboard Bridge (WKWebView ↔ Native Shell)

The React dashboard is embedded directly into `ClefVoice.app/Contents/Resources/web` and rendered inside a high-performance `WKWebView`. The injected `window.clefVoice.call(method, params)` bridge provides direct access to native and engine operations:
- `getState`, `getSettings`, `updateSettings`, `getSetupState`, `completeSetup`, `retryEngine`
- `getModels`, `downloadModel`, `loadModel`, `deleteModel`, `cancelDownload`
- `getLanguages`, `getModelSizes`, `getHotkeys`, `recordHotkey`
- `checkPermissions`, `requestAccessibility`, `requestMicrophone`
- `copyText`, `getHistory`, `getStats`, `clearHistory`, `deleteHistoryItem`, `setHistoryFavorite`

---

## Features

- **Local transcription** — First-time setup lets you grant permissions and choose a Whisper model to download (or use a cached one). After that, transcription runs on your device with `whisper.cpp`; audio and transcript data are not uploaded.
- **Local history** — Search Thai and English words together, star favorite transcripts, and copy previous text. History stores up to 1,000 transcripts in plain text in `~/.clefvoice/history.json`, restricted to the current macOS user. Favorites are part of that same retained history, not a separate permanent archive; Clear also removes favorites.
- **Multilingual recognition** — New installations use **Auto Detect**. Select a single language to fix detection, or multiple languages to keep automatic detection. Existing language preferences are preserved. Custom Vocabulary provides spelling hints for names and technical terms; recognition quality varies with the model and audio. Vocabulary is limited to 64 entries, 64 Unicode characters per entry and 512 in total. It is a hint, and Whisper may truncate it to its token budget, especially for non-Latin text. Oversized legacy vocabulary remains visible for correction; only hints within the limit are sent, and new invalid patches are rejected.
- **Model selection** — Download, select and remove any model from the Models page, including the active one when dictation is idle. History records the model and measured time to transcript for new sessions.
- **Dashboard and floating HUD** — The dashboard opens on launch; the HUD shows microphone levels while recording.
- **Text insertion** — After transcription, the app uses the clipboard and `Cmd+V` to insert text into the focused field. The app checks the original application and, when Accessibility exposes it, the focused field before dispatch. If focus changed or pasting fails, use Copy latest or History. Sending Cmd+V cannot prove that the target accepted the text; some apps do not expose field identity.
- **Custom Vocabulary & Cleanup** — User-added terms are passed to Whisper as spelling hints; filler words such as `um`, `uh`, `เอ่อ`, and `แบบว่า` can be removed.
- **Hold-to-Talk Hotkey** — Fn is the default. In Preferences, click **Record shortcut** to capture a modifier key or modifier + key combination. The shortcut is saved and restored on launch; press and hold it to dictate. Escape cancels shortcut recording.
- **Optional Auto-stop** — Disabled by default; enable it in Voice & Audio to end dictation after a pause.

---

## Getting Started

### Requirements
- **macOS:** macOS 13.0 (Ventura) or later (Apple Silicon tested; Intel runtime testing is still limited)
- **Node.js:** v22+
- **Go:** 1.26.9+ (patched standard library; Go can download the required toolchain automatically)
- **CMake:** required to build whisper.cpp
- **Xcode Command Line Tools:** `xcode-select --install`

The first build needs internet access to install dependencies and fetch the pinned
whisper.cpp source. On first launch, setup walks you through permissions and
model selection. Download your chosen model from the [whisper.cpp model repository](https://huggingface.co/ggerganov/whisper.cpp), then click **Use model** (setup also offers **Download & use**).
Verified cached models can be reused; no model downloads automatically. Transcription itself runs locally.

### Build & Run

1. **Clone the repository, install frontend dependencies and build the application:**
   ```bash
   git clone https://github.com/lalkai/clef-voice.git
   cd clef-voice
   ```
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

3. **First-Time Setup:** Click **Grant** for Microphone and Accessibility in the setup screen, then continue to choose, download and use a model. Click **Finish setup** once the model is ready. Setup is shown until you finish it, then stays completed on this Mac. Manage permissions in **Preferences** and models in **Models**. The app only requests Microphone and Accessibility; it does not request Input Monitoring.

4. **Dictate:**
   - Click cursor into any text field (Terminal, Notes, Notion, Browser, IDE).
   - **Hold `🌐 Fn`** (or your selected hotkey), speak your text, and release.
   - Wait for transcription to finish. The app then attempts to paste the text
     into the focused field; use History to copy it if pasting is unavailable.

### Shared app configuration

Change the app version with `npm run version:set -- 0.4.1` (replace the number for the next release). This updates the central config and generated Go, Swift and UI values without changing Git or npm dependency versions. Private npm packages do not carry a separate app version.

Edit `app.config.json` for the version, app name, bundle identifier, model catalog,
default model, VAD threshold, shared settings defaults, and the typing speed used
by statistics. Builds sync these values into React, Go and Swift automatically. Generated files are committed so direct Go/Swift builds work
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

The bundle uses an optimized Swift release build and targets macOS 13.0 in both the native shell and Go/C++ engine. Packaging verifies deployment targets, matching CPU architectures, system library dependencies, licenses and the signature. This validation does not replace testing on macOS 13 or on a second Mac.

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

The **Models** page separates models on your Mac from those available to download.
Search by name and filter by language. English-only, specialized and earlier models
are collapsed by default. Base remains the default; adding catalog entries does not
automatically download them. Download a model, then click **Use model**.

| Model | Download | Languages | Format |
| --- | --- | --- | --- |
| Whisper Tiny / Base / Small | 78 / 148 / 488 MB | Multilingual | F16 |
| Whisper Medium | 492 MB | Multilingual | Q4_1 |
| Whisper Large V3 Turbo | 1.62 GB | Multilingual | F16 |
| Whisper Large V3 | 1.08 GB | Multilingual | Q5_0 |
| Whisper Tiny / Base / Small / Medium English | 78 / 148 / 488 MB / 1.53 GB | English only | F16 |
| Breeze ASR 25 | 1.08 GB | Mandarin and English | Q5_K |
| Whisper Large V1 / V2 | 3.09 GB each | Multilingual | F16 |

The catalog uses GGML files supported by whisper.cpp, including the quantized
Medium, Large V3 and Breeze variants used in [Handy's model manager](https://github.com/cjpais/Handy/blob/a94b403e0610049fafa54b0a4077db2945084dd8/src-tauri/src/managers/model.rs).
Handy's newer GGUF catalog and non-Whisper engines are not supported here.
Download URLs are pinned to Hugging Face revisions and verified against SHA256;
Medium and Breeze use the [COCO mirror](https://huggingface.co/coco-research/coco-voice-models).
File sizes are not RAM requirements. Compare the same phrases on your Mac,
including names and technical terms, and check History timings.
English-only models force English for that session without changing your saved
language preferences. Breeze is tuned for Mandarin and English; these are its
manual language choices in the app. Auto (or multiple selections) uses the model's
own language detection and does not enforce a language whitelist. The app offers
27 manual language choices, not the full list supported by every Whisper model.
History's language field records the session configuration, not detected language.

- The engine prepares the saved model on startup. `ready` means the process can
  accept commands; only `model_loaded` means speech recognition is ready.
- Status moves through `loading` (checking the cached file), `downloading` when
  needed, `loading` (Whisper initialization), and finally `idle`. Download 100%
  alone does not mean initialization is complete.
- Cached files are verified with SHA256. Downloads use temporary files and become
  available only after HTTP, length, and checksum checks succeed. Failed downloads
  can be retried on the Models page. Progress includes bytes received and total size
  when known. You can delete the active model when dictation is idle; the app releases it and waits for a new selection. Missing or
  corrupt saved models fall back to a verified cached model; if none is usable,
  the app waits for you to download and choose one. Model actions are disabled while loading, downloading, recording, or
  transcribing. A failed switch keeps the previous model and selection.
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

### Recovery and model operations

Model mutations return an acknowledgement and a terminal result; busy requests fail
without replacing an active recording. After a process failure, recovery retries at
most three times with backoff. Use Retry engine after the limit; recording commands
are never replayed. Cached models other than the startup choice remain unverified
until Use model. Verification with SHA256 is still required before initialization.
Cancel is available during download/verification, not during native model initialization.
Quit requests graceful engine shutdown, with forced termination only after a deadline.
PID-labelled orphan downloads are removed only when their writer is definitely gone;
legacy `.part` files with unknown ownership are left alone.


### Regression checks

```bash
(cd core && go test ./...)
(cd core && go test -race ./internal/engine ./internal/models ./internal/history ./internal/postprocess)
node --test app/tests/*.test.mjs scripts/tests/*.test.mjs
npm --prefix app run build
(cd native/macos && swift build)
(cd core && go build -o /tmp/clefvoice-test-clefd ./cmd/clefd)
CLEF_TEST_ENGINE=/tmp/clefvoice-test-clefd swift test --package-path native/macos
```


## Contributing

Bug reports and focused pull requests are welcome. For a reproducible report,
include the app version, macOS version, chip, model, target app and the steps that
failed. If useful, add a short sample you are comfortable making public; avoid
posting private history, recordings or vocabulary.

Run the regression checks above before submitting a change. Native bridge tests
need the frontend dependencies installed. `npm run app:dev` runs a **UI preview**
with sample data; it does not record audio or prove the macOS integration works.
Test dictation in the built app. A release still needs manual permission, microphone,
sleep/wake and text-insertion checks on real target apps.

## License

[MIT License](LICENSE)

Whisper model weights are provided by [OpenAI under the MIT License](https://github.com/openai/whisper/blob/main/LICENSE). Breeze ASR 25 is a separate fine-tune distributed under [Apache-2.0](https://huggingface.co/MediaTek-Research/Breeze-ASR-25). Model licenses are separate from the app’s MIT license.
The app downloads converted model files from the repositories linked in the model table above.

App bundles include `Contents/Resources/THIRD_PARTY_NOTICES.txt`, collected from the actual installed runtime dependencies during packaging. This includes whisper.cpp/ggml, Go, malgo/miniaudio, React and the UI libraries; their licenses are separate from ClefVoice's MIT license.
