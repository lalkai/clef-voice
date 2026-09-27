package models

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func fixture(t *testing.T, status int, body string, length int64) (*Manager, Size, *int) {
	t.Helper()
	calls := new(int)
	s := Size{Str: "fixture", SHA256: fmt.Sprintf("%x", sha256.Sum256([]byte("valid model")))}
	m := &Manager{Dir: t.TempDir(), client: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		*calls++
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), ContentLength: length, Header: make(http.Header)}, nil
	})}}
	return m, s, calls
}
func noParts(t *testing.T, m *Manager) {
	t.Helper()
	files, _ := filepath.Glob(filepath.Join(m.Dir, "*.part"))
	if len(files) != 0 {
		t.Fatalf("partial files leaked: %v", files)
	}
}
func TestDownloadVerifiedThenReuse(t *testing.T) {
	m, s, calls := fixture(t, 200, "valid model", 11)
	var progress []float64
	path, err := m.Download(s, func(p float64) { progress = append(progress, p) })
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyChecksum(s, path); err != nil {
		t.Fatal(err)
	}
	if len(progress) == 0 || progress[0] != 0 || progress[len(progress)-1] != 1 {
		t.Fatalf("progress: %v", progress)
	}
	if _, err = m.Download(s, nil); err != nil {
		t.Fatal(err)
	}
	if *calls != 1 {
		t.Fatalf("cache downloaded again: %d", *calls)
	}
	noParts(t, m)
}
func TestDownloadRejectsBadResponses(t *testing.T) {
	for _, tt := range []struct {
		name   string
		status int
		body   string
		length int64
	}{
		{"http error", 404, "not found", 9},
		{"corrupt", 200, "bad model", 9},
		{"truncated", 200, "valid model", 100},
	} {
		t.Run(tt.name, func(t *testing.T) {
			m, s, _ := fixture(t, tt.status, tt.body, tt.length)
			if _, err := m.Download(s, nil); err == nil {
				t.Fatal("expected failure")
			}
			if m.IsDownloaded(s) {
				t.Fatal("invalid final file exists")
			}
			noParts(t, m)
		})
	}
}
func TestCorruptCacheIsRepaired(t *testing.T) {
	m, s, calls := fixture(t, 200, "valid model", -1)
	if err := os.WriteFile(m.LocalPath(s), []byte("corrupt cached model"), 0600); err != nil {
		t.Fatal(err)
	}
	path, err := m.Download(s, nil)
	if err != nil {
		t.Fatal(err)
	}
	if *calls != 1 {
		t.Fatal("corrupt cache trusted")
	}
	if err := verifyChecksum(s, path); err != nil {
		t.Fatal(err)
	}
	noParts(t, m)
}
func TestDownloadCancelled(t *testing.T) {
	m, s, calls := fixture(t, 200, "valid model", 11)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := m.DownloadContext(ctx, s, nil); err != context.Canceled {
		t.Fatalf("got %v", err)
	}
	if *calls != 0 {
		t.Fatal("cancelled request was sent")
	}
	noParts(t, m)
}

func TestCancellationDuringRequest(t *testing.T) {
	m, s, _ := fixture(t, 200, "valid model", 11)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	m.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		cancel()
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	if _, err := m.DownloadContext(ctx, s, nil); err == nil {
		t.Fatal("cancelled download succeeded")
	}
	if m.IsDownloaded(s) {
		t.Fatal("cancelled model exists")
	}
	noParts(t, m)
}
