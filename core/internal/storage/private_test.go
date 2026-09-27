package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWritePrivateFileReplacesExistingContent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "history.json")
	if err := os.WriteFile(path, []byte("old transcript"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := WritePrivateFile(path, []byte("new transcript")); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "new transcript" {
		t.Fatalf("saved content = %q", got)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0600 {
		t.Fatalf("saved permissions = %04o, want 0600", got)
	}
	if leftovers, err := filepath.Glob(filepath.Join(dir, ".history.json-*")); err != nil || len(leftovers) != 0 {
		t.Fatalf("temporary files left behind: %v, %v", leftovers, err)
	}
}
