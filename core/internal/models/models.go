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
	Str           string
	DisplayName   string
	Name          string
	SizeLabel     string
	SHA256        string
	Filename      string
	URL           string
	Bytes         int64
	Group         string
	Languages     []string
	LanguageLabel string
	Quantization  string
}

var All = func() []Size {
	sizes := make([]Size, 0, len(appconfig.Models))
	for _, model := range appconfig.Models {
		sizes = append(sizes, Size{Str: model.ID, DisplayName: model.Label, Name: model.Name, SizeLabel: model.SizeLabel, SHA256: model.SHA256, Filename: model.Filename, URL: model.URL, Bytes: model.SizeBytes, Group: model.Group, Languages: model.Languages, LanguageLabel: model.LanguageLabel, Quantization: model.Quantization})
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

func (s Size) FileName() string {
	if s.Filename != "" {
		return s.Filename
	}
	return "ggml-" + s.Str + ".bin"
}
func (s Size) DownloadURL() string {
	if s.URL != "" {
		return s.URL
	}
	return baseURL + "/" + s.FileName()
}

// Manager locates and downloads model files, verifying their SHA256.
type Manager struct {
	Dir    string
	Client *http.Client
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
	cleanupOrphanParts(dir)
	return &Manager{Dir: dir, Client: &http.Client{Timeout: 30 * time.Minute}}
}

func (m *Manager) LocalPath(s Size) string { return filepath.Join(m.Dir, s.FileName()) }

func (m *Manager) IsDownloaded(s Size) bool {
	return m.Verify(context.Background(), s) == nil
}

// Download fetches the model if missing, reporting progress 0..1 via onProgress,
// then verifies the SHA256 checksum.
func (m *Manager) Download(s Size, onProgress func(float64)) (string, error) {
	return m.DownloadContext(context.Background(), s, onProgress)
}

func (m *Manager) DownloadContext(ctx context.Context, s Size, onProgress func(float64)) (string, error) {
	return m.DownloadWithProgress(ctx, s, func(p Progress) {
		if onProgress != nil {
			onProgress(p.Fraction)
		}
	})
}

// HTTPError preserves the server response code for actionable UI errors.
type HTTPError struct{ StatusCode int }

func (e *HTTPError) Error() string { return fmt.Sprintf("model server returned HTTP %d", e.StatusCode) }

type Progress struct {
	Fraction float64
	Received int64
	Total    int64
}

func (m *Manager) DownloadWithProgress(ctx context.Context, s Size, onProgress func(Progress)) (string, error) {
	if onProgress == nil {
		onProgress = func(Progress) {}
	}
	dest := m.LocalPath(s)
	// Existing files may be truncated or left over from older app versions.
	if m.Verify(ctx, s) == nil {
		return dest, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err := os.MkdirAll(m.Dir, 0o755); err != nil {
		return "", err
	}
	onProgress(Progress{Total: -1})
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.DownloadURL(), nil)
	if err != nil {
		return "", err
	}
	client := m.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Minute}
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("download %s: %w", s.Str, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download %s: %w", s.Str, &HTTPError{StatusCode: resp.StatusCode})
	}
	out, err := os.CreateTemp(m.Dir, fmt.Sprintf("%s.%d-*.part", s.FileName(), os.Getpid()))
	if err != nil {
		return "", fmt.Errorf("create download file: %w", err)
	}
	tmp := out.Name()
	defer os.Remove(tmp)
	defer out.Close()
	total := resp.ContentLength
	if total <= 0 && s.Bytes > 0 {
		total = s.Bytes
	}
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
			p := Progress{Received: received, Total: total}
			if p.Total > 0 {
				p.Fraction = min(1, float64(received)/float64(p.Total))
			}
			onProgress(p)
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return "", fmt.Errorf("read download: %w", rerr)
		}
	}
	if (resp.ContentLength >= 0 && received != resp.ContentLength) || (s.Bytes > 0 && received != s.Bytes) {
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
	onProgress(Progress{Fraction: 1, Received: received, Total: total})
	return dest, nil
}

// Verify accepts only regular model files; symlinks cannot redirect model operations.
func (m *Manager) Verify(ctx context.Context, s Size) error {
	path := m.LocalPath(s)
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() == 0 {
		return fmt.Errorf("invalid model file: %s", s.Str)
	}
	if s.Bytes > 0 && info.Size() != s.Bytes {
		return fmt.Errorf("model size mismatch for %s", s.Str)
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	buf := make([]byte, 128*1024)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, err := f.Read(buf)
		h.Write(buf[:n])
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	if fmt.Sprintf("%x", h.Sum(nil)) != s.SHA256 {
		return fmt.Errorf("checksum mismatch for %s", s.Str)
	}
	return ctx.Err()
}

func (m *Manager) Delete(s Size) error {
	if _, ok := FromStr(s.Str); !ok {
		return fmt.Errorf("unknown model")
	}
	path := m.LocalPath(s)
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("model path is not a regular file")
	}
	return os.Remove(path)
}

// SessionLanguages respects model restrictions without changing saved preferences.
func (s Size) SessionLanguages(configured []string) []string {
	if len(s.Languages) == 1 {
		return append([]string(nil), s.Languages...)
	}
	if len(s.Languages) == 0 {
		return append([]string(nil), configured...)
	}
	var codes []string
	for _, code := range configured {
		for _, allowed := range s.Languages {
			if code == allowed {
				codes = append(codes, code)
				break
			}
		}
	}
	return codes
}
