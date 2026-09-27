package config

import (
	"os"
	"path/filepath"
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
