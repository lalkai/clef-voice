package engine

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"github.com/clefvoice/core/internal/config"
	"github.com/clefvoice/core/internal/models"
	"github.com/clefvoice/core/internal/protocol"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestBusyStartPreservesTranscription(t *testing.T) {
	var out bytes.Buffer
	e := &Engine{emit: protocol.NewEmitter(&out), transcribing: true, recordingSessionID: "original"}
	e.StartRecording("attempted-new-session")
	if !e.transcribing || strings.Contains(out.String(), `"type":"error"`) || !strings.Contains(out.String(), `"status":"transcribing"`) {
		t.Fatal(out.String())
	}
	if e.recordingSessionID != "original" || !strings.Contains(out.String(), `"session_id":"original"`) {
		t.Fatal("busy start replaced original session", out.String())
	}
	e.StopRecording()
	if !e.transcribing {
		t.Fatal("late stop cancelled inference")
	}
}
func TestModelRequestBusyAndCompletionHaveMatchingIDs(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e, _ := lifecycleFixture(t, &out)
	e.transcribing = true
	e.Handle(protocol.Command{Cmd: protocol.CmdDownloadModel, Model: "base", RequestID: "busy"})
	if !strings.Contains(out.String(), `"state":"busy"`) || e.loading {
		t.Fatal(out.String())
	}
	e.transcribing = false
	out.Reset()
	e.Handle(protocol.Command{Cmd: protocol.CmdDownloadModel, Model: "base", RequestID: "download"})
	finishModelOperation(t, e)
	if strings.Count(out.String(), `"request_id":"download"`) != 2 || !strings.Contains(out.String(), `"state":"accepted"`) || !strings.Contains(out.String(), `"state":"completed"`) {
		t.Fatal(out.String())
	}
}
func TestCancelVerificationHasTerminalResult(t *testing.T) {
	var out bytes.Buffer
	e, _ := lifecycleFixture(t, &out)
	e.loading = true
	e.modelOperation = "download"
	e.modelRequestID = "cancelled-request"
	e.loadingModel = "base"
	e.loadCh = make(chan loadMsg, 1)
	ctx, cancel := context.WithCancel(context.Background())
	e.loadCancel = cancel
	e.Handle(protocol.Command{Cmd: protocol.CmdCancelDownload, RequestID: "cancel"})
	if ctx.Err() == nil {
		t.Fatal("cancel was ignored")
	}
	e.loadCh <- loadMsg{done: true, operation: "cancel", err: ctx.Err()}
	e.PollLoad()
	if e.loading || !strings.Contains(out.String(), `"request_id":"cancelled-request"`) || !strings.Contains(out.String(), `"state":"failed"`) {
		t.Fatal(out.String())
	}
}
func TestStartupDoesNotVerifyUnrelatedModel(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e, _ := lifecycleFixture(t, &out)
	e.cfg.Model = "base"
	writeModel(t, e, "base")
	writeModel(t, e, "small")
	e.Startup()
	finishModelOperation(t, e)
	item := e.modelItem("small")
	if item.Status != "unverified" || item.Downloaded || !item.Present {
		t.Fatalf("unrelated model was hashed: %+v", item)
	}
}
func TestInvalidVocabularyPatchKeepsPreviousConfigAndRejects(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e := &Engine{emit: protocol.NewEmitter(&out), cfg: config.Default()}
	before := strings.Join(e.cfg.CustomVocabulary, ",")
	patch, _ := json.Marshal(map[string]any{"custom_vocabulary": []string{strings.Repeat("ก", 65)}})
	e.Handle(protocol.Command{Cmd: protocol.CmdSetConfig, RequestID: "invalid", Config: patch})
	if strings.Contains(out.String(), `"type":"error"`) {
		t.Fatal("Correlated failure also emitted a duplicate global notice")
	}
	if strings.Join(e.cfg.CustomVocabulary, ",") != before || !strings.Contains(out.String(), `"state":"failed"`) {
		t.Fatal(out.String())
	}
}

func TestCancelRunningDownloadCleansPartAndCanRetry(t *testing.T) {
	var out bytes.Buffer
	e, _ := lifecycleFixture(t, &out)
	original := e.models.Client
	started := make(chan struct{})
	e.models.Client = &http.Client{Transport: modelTransport(func(request *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, ContentLength: -1, Body: &blockedDownload{ctx: request.Context(), started: started}}, nil
	})}
	e.Handle(protocol.Command{Cmd: protocol.CmdDownloadModel, Model: "base", RequestID: "first"})
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("body never started")
	}
	e.Handle(protocol.Command{Cmd: protocol.CmdCancelDownload, RequestID: "cancel"})
	finishModelOperation(t, e)
	parts, _ := filepath.Glob(filepath.Join(e.models.Dir, "*.part"))
	if len(parts) != 0 || !strings.Contains(out.String(), `"request_id":"first"`) || !strings.Contains(out.String(), `"state":"failed"`) {
		t.Fatal(out.String(), parts)
	}
	e.models.Client = original
	e.Handle(protocol.Command{Cmd: protocol.CmdDownloadModel, Model: "base", RequestID: "retry"})
	finishModelOperation(t, e)
	if !e.modelItem("base").Downloaded {
		t.Fatal(out.String())
	}
}

type blockedDownload struct {
	ctx     context.Context
	started chan struct{}
}

func (body *blockedDownload) Read([]byte) (int, error) {
	close(body.started)
	<-body.ctx.Done()
	return 0, body.ctx.Err()
}
func (body *blockedDownload) Close() error { return nil }

func TestDownloadFailureReportsItsActualCategory(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		want string
	}{
		{"interrupted body", fmt.Errorf("read download: %w", io.ErrUnexpectedEOF), "connection ended"},
		{"forbidden", fmt.Errorf("download tiny: %w", &models.HTTPError{StatusCode: 403}), "HTTP 403"},
		{"missing", &models.HTTPError{StatusCode: 404}, "HTTP 404"},
		{"rate limit", &models.HTTPError{StatusCode: 429}, "HTTP 429"},
		{"server", &models.HTTPError{StatusCode: 503}, "HTTP 503"},
		{"DNS", &url.Error{Op: "Get", URL: "https://example.com/?private=do-not-display", Err: &net.DNSError{Err: "no such host", Name: "example.com"}}, "DNS"},
		{"TLS", &url.Error{Op: "Get", URL: "https://example.com", Err: x509.UnknownAuthorityError{}}, "TLS certificate"},
		{"timeout", &url.Error{Op: "Get", URL: "https://example.com", Err: context.DeadlineExceeded}, "timed out"},
		{"network denied", &url.Error{Op: "Get", URL: "https://example.com", Err: syscall.EPERM}, "Network access was denied"},
		{"disk permissions", &os.PathError{Op: "open", Path: "private-folder", Err: syscall.EACCES}, "model folder"},
	} {
		t.Run(test.name, func(t *testing.T) {
			message := modelError("download", test.err)
			if !strings.Contains(message, test.want) || strings.Contains(message, "private=") || strings.Contains(message, "private-folder") {
				t.Fatal(message)
			}
		})
	}
}
