package models

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/clefvoice/core/internal/appconfig"
)

const baseURL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"

// Size is a whisper model size.
type Size struct {
	Str         string
	DisplayName string
	SHA256      string
}

var All = func() []Size {
	sizes := make([]Size, 0, len(appconfig.Models))
	for _, model := range appconfig.Models {
		sizes = append(sizes, Size{Str: model.ID, DisplayName: model.Label, SHA256: model.SHA256})
	}
	return sizes
}()

// FromStr resolves a size by its string identifier.
func FromStr(s string) (Size, bool) {
	for _, sz := range All {
		if sz.Str == s {
			return sz, true
		}
	}
	return Size{}, false
}

func (s Size) FileName() string    { return "ggml-" + s.Str + ".bin" }
func (s Size) DownloadURL() string { return baseURL + "/" + s.FileName() }

// Manager locates and downloads model files, verifying their SHA256.
type Manager struct {
	Dir    string
	client *http.Client
}

func NewManager(override string) *Manager {
	dir := override
	if dir == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			base = "."
		}
		// UserConfigDir on macOS returns ~/Library/Application Support,
		// where the whisper models are stored.
		dir = filepath.Join(base, "ClefVoice", "Models")
	}
	os.MkdirAll(dir, 0o755)
	return &Manager{Dir: dir, client: &http.Client{Timeout: 30 * time.Minute}}
}

func (m *Manager) LocalPath(s Size) string { return filepath.Join(m.Dir, s.FileName()) }

func (m *Manager) IsDownloaded(s Size) bool {
	info, err := os.Stat(m.LocalPath(s))
	return err == nil && info.Mode().IsRegular() && info.Size() > 0
}

// Download fetches the model if missing, reporting progress 0..1 via onProgress,
// then verifies the SHA256 checksum.
func (m *Manager) Download(s Size, onProgress func(float64)) (string, error) {
	return m.DownloadContext(context.Background(), s, onProgress)
}

func (m *Manager) DownloadContext(ctx context.Context, s Size, onProgress func(float64)) (string, error) {
	if onProgress == nil {
		onProgress = func(float64) {}
	}
	dest := m.LocalPath(s)
	// Existing files may be truncated or left over from older app versions.
	if m.IsDownloaded(s) && verifyChecksum(s, dest) == nil {
		return dest, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := os.MkdirAll(m.Dir, 0o755); err != nil {
		return "", err
	}
	onProgress(0)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.DownloadURL(), nil)
	if err != nil {
		return "", err
	}
	client := m.client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Minute}
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("download %s: %w", s.Str, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download %s: HTTP %d", s.Str, resp.StatusCode)
	}
	out, err := os.CreateTemp(m.Dir, s.FileName()+"-*.part")
	if err != nil {
		return "", fmt.Errorf("create download file: %w", err)
	}
	tmp := out.Name()
	defer os.Remove(tmp)
	defer out.Close()
	h := sha256.New()
	buf := make([]byte, 128*1024)
	var received int64
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, err := out.Write(buf[:n]); err != nil {
				return "", fmt.Errorf("write download: %w", err)
			}
			h.Write(buf[:n])
			received += int64(n)
			if resp.ContentLength > 0 {
				onProgress(min(1, float64(received)/float64(resp.ContentLength)))
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return "", fmt.Errorf("read download: %w", rerr)
		}
	}
	if resp.ContentLength >= 0 && received != resp.ContentLength {
		return "", fmt.Errorf("incomplete download of %s", s.Str)
	}
	if actual := fmt.Sprintf("%x", h.Sum(nil)); actual != s.SHA256 {
		return "", fmt.Errorf("checksum mismatch for %s (corrupt download)", s.Str)
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := out.Sync(); err != nil {
		return "", err
	}
	if err := out.Close(); err != nil {
		return "", err
	}
	// Only verified, fully written files become visible at the final path.
	if err := os.Rename(tmp, dest); err != nil {
		return "", fmt.Errorf("finalize download: %w", err)
	}
	onProgress(1)
	return dest, nil
}

func verifyChecksum(s Size, path string) error {
	actual, err := sha256File(path)
	if err != nil {
		return err
	}
	if actual != s.SHA256 {
		return fmt.Errorf("checksum mismatch for %s (corrupt download): expected %s, got %s", s.Str, s.SHA256, actual)
	}
	return nil
}

func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("failed to open %s: %w", path, err)
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}
