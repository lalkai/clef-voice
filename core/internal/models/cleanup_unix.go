//go:build darwin || linux

package models

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

func cleanupOrphanParts(dir string) {
	cleanupParts(dir, func(pid int) bool { return !errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) })
}

// Only PID-labelled downloads with a definitely dead owner are ours to remove.
func cleanupParts(dir string, alive func(int) bool) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || !strings.HasSuffix(entry.Name(), ".part") {
			continue
		}
		for _, model := range All {
			suffix, ok := strings.CutPrefix(entry.Name(), model.FileName()+".")
			if !ok {
				continue
			}
			owner, _, ok := strings.Cut(suffix, "-")
			if !ok {
				continue
			}
			pid, err := strconv.Atoi(owner)
			if err == nil && pid > 0 && !alive(pid) {
				_ = os.Remove(filepath.Join(dir, entry.Name()))
			}
		}
	}
}
