package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestDefaultHotkeyIsFnAndSavedChoiceIsPreserved(t *testing.T) {
	if got := Default().Hotkey; got != "Fn" {
		t.Fatalf("default hotkey = %q, want Fn", got)
	}

	t.Setenv("HOME", t.TempDir())
	cfg := Default()
	cfg.Hotkey = "leftControl"
	if err := Save(cfg); err != nil {
		t.Fatal(err)
	}
	if got := Load().Hotkey; got != "leftControl" {
		t.Fatalf("saved hotkey = %q, want leftControl", got)
	}
}

func TestAutoStopDefaultsOffButSavedChoiceIsPreserved(t *testing.T) {
	if Default().AutoStopEnabled {
		t.Fatal("auto-stop should be disabled for a new installation")
	}
	t.Setenv("HOME", t.TempDir())
	cfg := Default()
	cfg.AutoStopEnabled = true
	if err := Save(cfg); err != nil {
		t.Fatal(err)
	}
	if !Load().AutoStopEnabled {
		t.Fatal("loading config ignored the saved auto-stop setting")
	}
}

func TestLoadRestrictsExistingConfigPermissions(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	dir := filepath.Join(os.Getenv("HOME"), ".clefvoice")
	if err := os.Mkdir(dir, 0755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(`{"hotkey":"Fn"}`), 0644); err != nil {
		t.Fatal(err)
	}
	Load()
	for path, want := range map[string]os.FileMode{dir: 0700, path: 0600} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != want {
			t.Errorf("%s permissions = %04o, want %04o", path, got, want)
		}
	}
}

func TestSaveReplacesExistingConfigPrivately(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	dir := filepath.Join(os.Getenv("HOME"), ".clefvoice")
	if err := os.Mkdir(dir, 0755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(`{"hotkey":"Fn"}`), 0644); err != nil {
		t.Fatal(err)
	}
	cfg := Default()
	cfg.Hotkey = "leftControl"
	if err := Save(cfg); err != nil {
		t.Fatal(err)
	}
	if got := Load().Hotkey; got != cfg.Hotkey {
		t.Fatalf("saved hotkey = %q, want %q", got, cfg.Hotkey)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0600 {
		t.Fatalf("saved config permissions = %04o, want 0600", got)
	}
}

func TestNewConfigUsesAutoAndPreservesExplicitLanguages(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	if len(Load().Languages) != 0 {
		t.Fatal("new installs must use automatic language detection")
	}
	for _, codes := range [][]string{{"th"}, {"en"}, {"th", "en"}, {}} {
		cfg := Default()
		cfg.Languages = codes
		if err := Save(cfg); err != nil {
			t.Fatal(err)
		}
		got := Load().Languages
		if len(got) != len(codes) {
			t.Fatalf("saved language selection changed: %v", got)
		}
		for i := range codes {
			if got[i] != codes[i] {
				t.Fatalf("saved language selection changed: %v", got)
			}
		}
	}
}

func TestInvalidFileDoesNotApplyPartialSettings(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	dir := filepath.Join(os.Getenv("HOME"), ".clefvoice")
	os.MkdirAll(dir, 0700)
	for _, input := range []string{`{"vad_enabled":false,"auto_stop_seconds":"bad"}`, `{"vad_threshold":0}`, `{"auto_stop_seconds":-1}`} {
		os.WriteFile(filepath.Join(dir, "config.json"), []byte(input), 0600)
		if got := Load(); !reflect.DeepEqual(got, Default()) {
			t.Fatalf("partial config applied: %+v", got)
		}
	}
}

func TestVocabularyUnicodeBudgetAndNormalization(t *testing.T) {
	cfg := Default()
	cfg.CustomVocabulary = []string{" ไทย ", "ไทย", "", "😀"}
	cfg.NormalizeVocabulary()
	if len(cfg.CustomVocabulary) != 2 || cfg.CustomVocabulary[0] != "ไทย" {
		t.Fatalf("normalization: %#v", cfg.CustomVocabulary)
	}
	cfg.CustomVocabulary = []string{strings.Repeat("😀", 64)}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Unicode characters counted as bytes: %v", err)
	}
	cfg.CustomVocabulary = []string{strings.Repeat("ก", 65)}
	if err := cfg.Validate(); err == nil {
		t.Fatal("oversize entry accepted")
	}
	cfg.CustomVocabulary = make([]string, 65)
	if err := cfg.Validate(); err == nil {
		t.Fatal("too many entries accepted")
	}
	cfg.CustomVocabulary = []string{}
	for i := 0; i < 9; i++ {
		cfg.CustomVocabulary = append(cfg.CustomVocabulary, strings.Repeat("ก", 64))
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("total budget exceeded")
	}
}

func TestLegacyVocabularyDoesNotResetOtherPreferences(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	cfg := Default()
	cfg.Hotkey = "LeftOption"
	cfg.CustomVocabulary = []string{strings.Repeat("ก", 65), "Swift"}
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(home, ".clefvoice")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	loaded := Load()
	if loaded.Hotkey != "LeftOption" || len(loaded.CustomVocabulary) != 2 {
		t.Fatal("legacy preferences were reset")
	}
	hints := VocabularyHints(loaded.CustomVocabulary)
	if len(hints) != 1 || hints[0] != "Swift" {
		t.Fatal(hints)
	}
}

func TestDefaultsDoNotReplaceSavedSettingsOrShareVocabulary(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	cfg := Default()
	cfg.Hotkey = "RightOption"
	cfg.AutoStopEnabled = true
	cfg.AutoStopSeconds = 1.5
	cfg.VADEnabled = false
	cfg.CustomVocabulary = []string{"คำของผู้ใช้"}
	if err := Save(cfg); err != nil {
		t.Fatal(err)
	}
	if got := Load(); !reflect.DeepEqual(got, cfg) {
		t.Fatalf("saved settings replaced: %#v", got)
	}
	first := Default()
	first.CustomVocabulary[0] = "changed"
	if Default().CustomVocabulary[0] == "changed" {
		t.Fatal("default vocabulary shared across configs")
	}
}
