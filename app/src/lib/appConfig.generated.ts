// Generated from app.config.json by scripts/sync-config.mjs. Do not edit.
export const appConfig = {
  "version": "0.4.0",
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
  "models": [
    {
      "id": "tiny",
      "name": "Tiny",
      "label": "Tiny (~75 MB - Fast)",
      "description": "Smallest download and lowest memory use. Useful for short phrases."
    },
    {
      "id": "base",
      "name": "Base",
      "label": "Base (~142 MB - Balanced)",
      "description": "The default model. A modest download and memory footprint."
    },
    {
      "id": "small",
      "name": "Small",
      "label": "Small (~466 MB - Accurate)",
      "description": "A larger model between Base and Large V3 Turbo in download size and memory use."
    },
    {
      "id": "large-v3-turbo",
      "name": "Turbo",
      "label": "Large V3 Turbo (~1.5 GB - Best)",
      "description": "Largest available model; uses more memory. Try with Thai names and mixed Thai/English."
    }
  ]
} as const;
