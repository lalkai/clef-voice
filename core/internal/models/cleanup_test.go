//go:build darwin || linux

package models

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCleanupPreservesLiveWriterAndLegacyParts(t *testing.T) {
	dir := t.TempDir()
	prefix := All[0].FileName()
	names := []string{prefix + ".999-x.part", prefix + ".123-x.part", prefix + "-legacy.part", prefix}
	for _, name := range names {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	cleanupParts(dir, func(pid int) bool { return pid == 123 })
	for i, name := range names {
		_, err := os.Stat(filepath.Join(dir, name))
		if (i == 0) != os.IsNotExist(err) {
			t.Fatalf("unexpected cleanup: %s %v", name, err)
		}
	}
}
