package lang

import "testing"

func TestResolveLanguageSingle(t *testing.T) {
	code := ResolveLanguage([]string{"en"})
	if code != "en" {
		t.Fatalf("expected en, got %q", code)
	}
}

func TestResolveLanguageMulti(t *testing.T) {
	code := ResolveLanguage([]string{"th", "en"})
	if code != "" {
		t.Fatalf("expected auto-detect (empty code) for multiple languages, got %q", code)
	}
}

func TestResolveLanguageEmpty(t *testing.T) {
	code := ResolveLanguage(nil)
	if code != "" {
		t.Fatalf("empty should yield empty, got %q", code)
	}
}

func TestResolveLanguageUnknown(t *testing.T) {
	code := ResolveLanguage([]string{"xx"})
	if code != "" {
		t.Fatalf("unknown code should fall back to auto-detect, got %q", code)
	}
}
