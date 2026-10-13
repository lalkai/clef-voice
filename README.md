# ClefVoice

Local voice typing for macOS. Hold **Fn**, speak, and release to transcribe with
Whisper and paste the result into the field you were using. Free, open source,
and no account or subscription required.

- Multilingual transcription, depending on the selected model.
- Download, switch and remove models from the app.
- Searchable history, favorites and custom vocabulary hints.
- Configurable shortcut, recording HUD and optional silence auto-stop.

Transcription runs on your Mac. Audio stays in memory during recording; text
history is stored locally in plain text at `~/.clefvoice/history.json`.
Internet is needed for model downloads. Clipboard managers, Universal Clipboard
and the destination app may sync pasted text according to their own settings.

## Install

Requires **macOS 13 or later**. Apple Silicon is tested; Intel runtime testing is
limited. Windows support is an unfinished prototype and is not packaged yet.

Download from [Releases](https://github.com/lalkai/clef-voice/releases), unzip or
open the DMG, and drag `ClefVoice.app` into Applications. Choose `arm64` for Apple
Silicon or `x86_64` for Intel when that build is available.

Or install the latest release with:

```bash
curl -fsSL https://raw.githubusercontent.com/lalkai/clef-voice/main/scripts/install-macos.sh | bash
```

The installer selects your architecture and installs into `/Applications`, or
`~/Applications` if needed. It checks the bundle version, identifier and signature,
and removes quarantine automatically. Quit ClefVoice before updating.
The command requires the installer script and matching release assets to be published.

Builds are **ad-hoc signed and not notarized**. For manual installation, macOS may
require **System Settings → Privacy & Security → Open Anyway**. For an installed
build you trust, you can also remove quarantine with:

```bash
xattr -dr com.apple.quarantine /Applications/ClefVoice.app
```

This bypasses the first-open quarantine check; it does not notarize the app.

## Use

1. Open ClefVoice and grant **Microphone** and **Accessibility** access.
2. Choose a model, click **Download & use**, then finish setup.
3. Focus a text field, hold **Fn**, speak, and release. Wait for the text to appear.

Change the shortcut in **Preferences** and manage models in **Models**.
Auto-stop is disabled by default. If pasting fails or you change focus while
transcription runs, copy the result from History.

Setup appears until you complete it. After that, permissions remain available in
Preferences and model management stays in Models. The app requests Microphone
for recording and Accessibility for shortcuts and text insertion; Input Monitoring
is not required.

### Models and languages

The default model is Whisper Base. The catalog includes multilingual and
English-only Whisper models, plus Breeze for Mandarin and English. Larger models
need more memory; download size is not the RAM requirement. Downloads use pinned
URLs and SHA256 verification.

| Model | Approximate download | Languages | Format |
| --- | --- | --- | --- |
| Whisper Tiny / Base / Small | 78 / 148 / 488 MB | Multilingual | F16 |
| Whisper Medium | 492 MB | Multilingual | Q4_1 |
| Whisper Large V3 Turbo | 1.62 GB | Multilingual | F16 |
| Whisper Large V3 | 1.08 GB | Multilingual | Q5_0 |
| Whisper Tiny / Base / Small / Medium English | 78 / 148 / 488 MB / 1.53 GB | English only | F16 |
| Breeze ASR 25 | 1.08 GB | Mandarin and English | Q5_K |
| Whisper Large V1 / V2 | 3.09 GB each | Multilingual | F16 |

Download models only when you choose them. A completed download still needs
verification and initialization before dictation is available. You can cancel a
download and retry a failed one; initialization itself cannot be cancelled.
Removing the active model while idle leaves the app waiting for a new selection.
A failed model switch keeps the previous working model.

Auto Detect is the default. Selecting one language fixes recognition to that
language; selecting several keeps automatic detection and does not restrict it
to those languages. English-only models always use English. Custom vocabulary
provides spelling hints, not guaranteed replacements. Vocabulary supports up to
64 entries, 64 Unicode characters per entry and 512 characters in total.

### History and text insertion

History keeps the latest 1,000 transcripts, including favorites. Clearing History
also removes favorites. New entries record the model and transcription processing
time; their language label represents session settings, not detected language.
WPM is an estimate based on recorded duration including pauses, and Thai word
counts are approximate.

Text insertion uses the clipboard and Cmd+V. The helper checks the original app
and, when available, the original focused field before pasting. Sending the paste
shortcut does not guarantee the receiving app accepted the text. If insertion
fails, use Copy latest or History to recover the transcript.

## Build from source

Install **Node.js 22+**, **Go 1.26.9+**, **CMake**, and Xcode Command Line Tools
(`xcode-select --install`). The first build requires internet access.

```bash
git clone https://github.com/lalkai/clef-voice.git
cd clef-voice
npm --prefix app ci
npm run build
open native/macos/ClefVoice.app
```

To build and install into Applications, including quarantine removal:

```bash
npm run install:mac
```

For a local build that macOS blocks:

```bash
xattr -dr com.apple.quarantine native/macos/ClefVoice.app
```

Rebuilding changes the ad-hoc signature and may require granting permissions again.
`npm run app:dev` runs a browser UI preview with sample data, not real dictation.

## Architecture

ClefVoice separates the transcription core from OS integration so future native
helpers can reuse the engine without rewriting model management or recognition.
The current supported helper is macOS; the Windows helper is still a prototype.

```text
ClefVoice
│
├── 🐹 core/                         # Shared Go core + whisper.cpp
│   ├── cmd/clefd/                  # Engine process and JSON-line command loop
│   └── internal/
│       ├── engine/                 # Dictation sessions and model lifecycle
│       ├── config/                 # Settings validation and persistence
│       ├── models/                 # Model downloads and checksum verification
│       ├── lang/                   # Language catalog and selection
│       ├── capture/                # miniaudio capture: 16 kHz mono float32
│       ├── vad/                    # Voice activity detection and silence trimming
│       ├── whisper/                # cgo wrapper; Metal acceleration on macOS
│       ├── postprocess/            # Text cleanup and word counting
│       └── history/                # Local transcripts, favorites and statistics
│
├── 🍏 native/macos/                 # Swift / AppKit native helper
│   ├── Sources/ClefVoice/
│   │   ├── Core/                   # IPC, hotkeys, permissions and text insertion
│   │   ├── UI/                     # Menu bar, HUD and WKWebView app window
│   │   └── App/                    # App entry point and lifecycle
│   └── Makefile
│
├── 🌐 app/                         # Shared React + Tailwind + Vite UI
│   └── src/                        # Overview, History, Vocabulary, Models,
│                                   # Voice & Audio, Preferences and Setup
│
├── 🪟 native/windows/               # Experimental C# / Win32 helper
│   ├── Program.cs                  # System tray
│   ├── HotkeyManager.cs            # Hold-to-talk keyboard hook
│   ├── TextInserter.cs             # SendInput paste
│   └── EngineClient.cs             # clefd.exe process and JSON-line transport
│
├── app.config.json                 # Shared app configuration
└── scripts/                        # Build, install and config generation
    └── tests/                      # Script tests and WKWebView fixtures
```

Helpers communicate with Go through JSON lines. Go confirms settings changes;
Swift adapts data for the UI without keeping a second writable configuration.
This lets another OS helper reuse the same core and React UI while implementing
its own shortcuts, permissions, windows and text insertion.

```text
React UI in WKWebView → Swift native helper → Go core → whisper.cpp
                     JS bridge             JSON lines
```

The core runs in a separate process. The helper retries a failed process up to
three times, then offers Retry engine. Recording commands are not replayed during
recovery.

## Development

`app.config.json` is the source for version, model catalog and shared defaults.
Builds generate Go, Swift and React values. Commit generated files with the config;
do not edit them directly. Existing user settings stay in `~/.clefvoice/config.json`.

```bash
npm run version:set -- 0.4.2
npm run config:sync
npm run config:check
```

Run checks after building the app:

```bash
go -C core test ./...
go -C core test -race ./internal/config ./internal/engine ./internal/models ./internal/history
node --test app/tests/*.test.mjs scripts/tests/*.test.mjs
CLEF_TEST_ENGINE="$PWD/core/build/clefd" swift test --package-path native/macos
```

Build/dev/install tools live in `scripts/`; test helpers live in `scripts/tests/`.

## Contributing

Issues and focused PRs are welcome. Include the app version, macOS version, chip,
model, target app and steps to reproduce a bug. Avoid sharing private transcripts
or recordings. Real-device checks for permissions, sleep/wake and text insertion
are still needed alongside automated tests.

## License

ClefVoice is [MIT licensed](LICENSE). Model licenses are separate:
[Whisper — MIT](https://github.com/openai/whisper/blob/main/LICENSE) and
[Breeze ASR 25 — Apache-2.0](https://huggingface.co/MediaTek-Research/Breeze-ASR-25).
Models are downloaded from [whisper.cpp on Hugging Face](https://huggingface.co/ggerganov/whisper.cpp)
and the [COCO mirror](https://huggingface.co/coco-research/coco-voice-models).
App bundles include dependency licenses in `Contents/Resources/THIRD_PARTY_NOTICES.txt`.
