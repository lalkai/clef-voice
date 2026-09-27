package lang

import "strings"

// Language describes a supported recognition language.
type Language struct {
	Code string
	Name string
}

// Languages is the full list of supported languages, matching the
// Swift WhisperLanguage enum.
var Languages = []Language{
	{"th", "Thai (ภาษาไทย)"},
	{"en", "English"},
	{"ja", "Japanese (日本語)"},
	{"zh", "Chinese (中文)"},
	{"es", "Spanish (Español)"},
	{"fr", "French (Français)"},
	{"de", "German (Deutsch)"},
	{"ko", "Korean (한국어)"},
	{"vi", "Vietnamese (Tiếng Việt)"},
	{"id", "Indonesian (Bahasa Indonesia)"},
	{"ms", "Malay (Bahasa Melayu)"},
	{"tl", "Filipino (Tagalog)"},
	{"ar", "Arabic (العربية)"},
	{"hi", "Hindi (हिन्दी)"},
	{"pt", "Portuguese (Português)"},
	{"ru", "Russian (Русский)"},
	{"it", "Italian (Italiano)"},
	{"tr", "Turkish (Türkçe)"},
	{"nl", "Dutch (Nederlands)"},
	{"sv", "Swedish (Svenska)"},
	{"pl", "Polish (Polski)"},
	{"cs", "Czech (Čeština)"},
	{"el", "Greek (Ελληνικά)"},
	{"he", "Hebrew (עברית)"},
	{"lo", "Lao (ລາວ)"},
	{"my", "Burmese (မြန်မာ)"},
	{"km", "Khmer (ខ្មែរ)"},
}

// ByCode returns the language for the given ISO 639-1 code, if supported.
func ByCode(code string) *Language {
	for i := range Languages {
		if Languages[i].Code == code {
			return &Languages[i]
		}
	}
	return nil
}

// ResolveLanguage forces a single selected language; multiple languages use
// auto-detection. Language examples are not sent as prompts because Whisper can
// repeat them when the microphone captures only background noise.
func ResolveLanguage(codes []string) string {
	var langs []Language
	seen := make(map[string]bool)
	for _, c := range codes {
		for _, sub := range strings.Split(c, ",") {
			code := strings.TrimSpace(sub)
			if code == "" || seen[code] {
				continue
			}
			if l := ByCode(code); l != nil {
				seen[code] = true
				langs = append(langs, *l)
			}
		}
	}
	if len(langs) == 1 {
		return langs[0].Code
	}
	return ""
}
