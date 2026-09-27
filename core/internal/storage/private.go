package storage

import (
	"os"
	"path/filepath"
)

// WritePrivateFile replaces a file only after its complete contents have been written.
func WritePrivateFile(path string, data []byte) error {
	if err := os.Chmod(path, 0600); err != nil && !os.IsNotExist(err) {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+"-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	if _, err := tmp.Write(data); err != nil {
		return err
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
