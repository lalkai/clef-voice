// Generated from app.config.json by scripts/sync-config.mjs. Do not edit.
export const appConfig = {
  "version": "0.4.1",
  "name": "ClefVoice",
  "bundleIdentifier": "com.clefvoice.app",
  "typingWpm": 40,
  "defaultModel": "base",
  "defaultVadThreshold": 0.012,
  "vadLevels": {
    "high": 0.005,
    "normal": 0.012,
    "low": 0.025
  },
  "settingsDefaults": {
    "hotkey": "Fn",
    "vadEnabled": true,
    "autoStopEnabled": false,
    "autoStopSeconds": 0.9,
    "removeFillerWords": true,
    "autoCapitalize": true,
    "customVocabulary": [
      "ClefVoice",
      "TypeScript",
      "TailwindCSS"
    ]
  },
  "models": [
    {
      "id": "tiny",
      "name": "Tiny",
      "label": "Whisper Tiny (~78 MB)",
      "description": "The smallest Whisper model. Prioritizes speed and a small download.",
      "sizeLabel": "~78 MB",
      "displayName": "Whisper Tiny",
      "filename": "ggml-tiny.bin",
      "group": "general",
      "languages": [],
      "languageLabel": "Multilingual",
      "quantization": "F16",
      "license": "MIT",
      "sizeBytes": 77691713,
      "downloadUrl": "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny.bin"
    },
    {
      "id": "base",
      "name": "Base",
      "label": "Whisper Base (~148 MB)",
      "description": "A lightweight Whisper model. Selected by default.",
      "sizeLabel": "~148 MB",
      "displayName": "Whisper Base",
      "filename": "ggml-base.bin",
      "group": "general",
      "languages": [],
      "languageLabel": "Multilingual",
      "quantization": "F16",
      "license": "MIT",
      "sizeBytes": 147951465,
      "downloadUrl": "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin"
    },
    {
      "id": "small",
      "name": "Small",
      "label": "Whisper Small (~488 MB)",
      "description": "A larger Whisper model than Base, with higher processing requirements.",
      "sizeLabel": "~488 MB",
      "displayName": "Whisper Small",
      "filename": "ggml-small.bin",
      "group": "general",
      "languages": [],
      "languageLabel": "Multilingual",
      "quantization": "F16",
      "license": "MIT",
      "sizeBytes": 487601967,
      "downloadUrl": "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.bin"
    },
    {
      "id": "medium",
      "name": "Medium",
      "displayName": "Whisper Medium",
      "label": "Whisper Medium (~492 MB)",
      "description": "Whisper Medium with 4-bit quantization to reduce the download size.",
      "sizeLabel": "~492 MB",
      "sizeBytes": 491852915,
      "filename": "whisper-medium-q4_1.bin",
      "downloadUrl": "https://huggingface.co/coco-research/coco-voice-models/resolve/3cb3e6de7c20f58fe5beaaab3d5159384feff3f0/medium/whisper-medium-q4_1.bin",
      "group": "general",
      "languages": [],
      "languageLabel": "Multilingual",
      "quantization": "Q4_1",
      "license": "MIT"
    },
    {
      "id": "large-v3-turbo",
      "name": "Turbo",
      "label": "Whisper Large V3 Turbo (~1.62 GB)",
      "description": "Large V3 with a reduced decoder, optimized for faster transcription.",
      "sizeLabel": "~1.62 GB",
      "displayName": "Whisper Large V3 Turbo",
      "filename": "ggml-large-v3-turbo.bin",
      "group": "general",
      "languages": [],
      "languageLabel": "Multilingual",
      "quantization": "F16",
      "license": "MIT",
      "sizeBytes": 1624555275,
      "downloadUrl": "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo.bin"
    },
    {
      "id": "large-v3",
      "name": "Large V3",
      "displayName": "Whisper Large V3",
      "label": "Whisper Large V3 (~1.08 GB)",
      "description": "Whisper Large V3 with 5-bit quantization to reduce the download size.",
      "sizeLabel": "~1.08 GB",
      "sizeBytes": 1081140203,
      "filename": "ggml-large-v3-q5_0.bin",
      "downloadUrl": "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-q5_0.bin",
      "group": "general",
      "languages": [],
      "languageLabel": "Multilingual",
      "quantization": "Q5_0",
      "license": "MIT"
    },
    {
      "id": "tiny-en",
      "name": "Tiny (English)",
      "displayName": "Whisper Tiny (English)",
      "label": "Whisper Tiny (English) (~78 MB)",
      "description": "The English-only variant of Whisper Tiny.",
      "sizeLabel": "~78 MB",
      "sizeBytes": 77704715,
      "filename": "ggml-tiny.en.bin",
      "downloadUrl": "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny.en.bin",
      "group": "english",
      "languages": [
        "en"
      ],
      "languageLabel": "English only",
      "quantization": "F16",
      "license": "MIT"
    },
    {
      "id": "base-en",
      "name": "Base (English)",
      "displayName": "Whisper Base (English)",
      "label": "Whisper Base (English) (~148 MB)",
      "description": "The English-only variant of Whisper Base.",
      "sizeLabel": "~148 MB",
      "sizeBytes": 147964211,
      "filename": "ggml-base.en.bin",
      "downloadUrl": "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin",
      "group": "english",
      "languages": [
        "en"
      ],
      "languageLabel": "English only",
      "quantization": "F16",
      "license": "MIT"
    },
    {
      "id": "small-en",
      "name": "Small (English)",
      "displayName": "Whisper Small (English)",
      "label": "Whisper Small (English) (~488 MB)",
      "description": "The English-only variant of Whisper Small.",
      "sizeLabel": "~488 MB",
      "sizeBytes": 487614201,
      "filename": "ggml-small.en.bin",
      "downloadUrl": "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.en.bin",
      "group": "english",
      "languages": [
        "en"
      ],
      "languageLabel": "English only",
      "quantization": "F16",
      "license": "MIT"
    },
    {
      "id": "medium-en",
      "name": "Medium (English)",
      "displayName": "Whisper Medium (English)",
      "label": "Whisper Medium (English) (~1.53 GB)",
      "description": "The English-only variant of Whisper Medium, with unquantized weights.",
      "sizeLabel": "~1.53 GB",
      "sizeBytes": 1533774781,
      "filename": "ggml-medium.en.bin",
      "downloadUrl": "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-medium.en.bin",
      "group": "english",
      "languages": [
        "en"
      ],
      "languageLabel": "English only",
      "quantization": "F16",
      "license": "MIT"
    },
    {
      "id": "breeze-asr",
      "name": "Breeze ASR",
      "displayName": "Breeze ASR 25",
      "label": "Breeze ASR 25 (~1.08 GB)",
      "description": "Based on Whisper Large V2, tuned for Taiwanese Mandarin and Mandarin–English code-switching.",
      "sizeLabel": "~1.08 GB",
      "sizeBytes": 1080732108,
      "filename": "breeze-asr-q5_k.bin",
      "downloadUrl": "https://huggingface.co/coco-research/coco-voice-models/resolve/3cb3e6de7c20f58fe5beaaab3d5159384feff3f0/breeze-asr/breeze-asr-q5_k.bin",
      "group": "specialized",
      "languages": [
        "zh",
        "en"
      ],
      "languageLabel": "Mandarin & English",
      "quantization": "Q5_K",
      "license": "Apache-2.0"
    },
    {
      "id": "large-v1",
      "name": "Large V1",
      "displayName": "Whisper Large V1",
      "label": "Whisper Large V1 (~3.09 GB)",
      "description": "The original Whisper Large model, with unquantized weights.",
      "sizeLabel": "~3.09 GB",
      "sizeBytes": 3094623691,
      "filename": "ggml-large-v1.bin",
      "downloadUrl": "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v1.bin",
      "group": "legacy",
      "languages": [],
      "languageLabel": "Multilingual",
      "quantization": "F16",
      "license": "MIT"
    },
    {
      "id": "large-v2",
      "name": "Large V2",
      "displayName": "Whisper Large V2",
      "label": "Whisper Large V2 (~3.09 GB)",
      "description": "The second-generation Whisper Large model, with unquantized weights.",
      "sizeLabel": "~3.09 GB",
      "sizeBytes": 3094623691,
      "filename": "ggml-large-v2.bin",
      "downloadUrl": "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v2.bin",
      "group": "legacy",
      "languages": [],
      "languageLabel": "Multilingual",
      "quantization": "F16",
      "license": "MIT"
    }
  ],
  "inputLimits": {
    "vocabularyWords": 64,
    "wordCharacters": 64,
    "vocabularyCharacters": 512,
    "commandBytes": 1000000
  }
} as const;
