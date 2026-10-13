package engine

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/clefvoice/core/internal/config"
	"github.com/clefvoice/core/internal/models"
	"github.com/clefvoice/core/internal/protocol"
	"github.com/clefvoice/core/internal/whisper"
)

type modelTransport func(*http.Request) (*http.Response, error)

func (f modelTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func lifecycleFixture(t *testing.T, out *bytes.Buffer) (*Engine, *[]string) {
	t.Helper()
	original := models.All
	models.All = append([]models.Size(nil), original...)
	for i := range models.All {
		models.All[i].Bytes = int64(len(models.All[i].Str + " weights"))
		models.All[i].SHA256 = fmt.Sprintf("%x", sha256.Sum256([]byte(models.All[i].Str+" weights")))
	}
	t.Cleanup(func() { models.All = original })
	requested := new([]string)
	e := &Engine{emit: protocol.NewEmitter(out), cfg: config.Default(), models: models.NewManager(t.TempDir())}
	e.models.Client = &http.Client{Transport: modelTransport(func(r *http.Request) (*http.Response, error) {
		*requested = append(*requested, r.URL.Path)
		id := ""
		for _, size := range models.All {
			if strings.HasSuffix(r.URL.Path, "/"+size.FileName()) {
				id = size.Str
				break
			}
		}
		data := id + " weights"
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(data)), ContentLength: int64(len(data))}, nil
	})}
	e.prepareModel = func(string, bool) (*whisper.Engine, error) { return &whisper.Engine{}, nil }
	t.Cleanup(e.Shutdown)
	return e, requested
}
func writeModel(t *testing.T, e *Engine, id string) {
	t.Helper()
	size, _ := models.FromStr(id)
	if err := os.WriteFile(e.models.LocalPath(size), []byte(id+" weights"), 0600); err != nil {
		t.Fatal(err)
	}
}
func finishModelOperation(t *testing.T, e *Engine) {
	t.Helper()
	timeout := time.After(3 * time.Second)
	for e.loading {
		e.PollLoad()
		select {
		case <-timeout:
			t.Fatal("model operation timed out")
		default:
		}
		time.Sleep(time.Millisecond)
	}
	e.loadWG.Wait()
}

func TestStartupSelectsVerifiedCacheWithoutNetwork(t *testing.T) {
	for _, state := range []string{"saved", "missing", "corrupt", "unknown"} {
		t.Run(state, func(t *testing.T) {
			t.Setenv("HOME", t.TempDir())
			var out bytes.Buffer
			e, calls := lifecycleFixture(t, &out)
			e.cfg.Model = "small"
			writeModel(t, e, "base")
			if state == "saved" {
				writeModel(t, e, "small")
			}
			if state == "corrupt" {
				os.WriteFile(e.models.LocalPath(mustModel("small")), []byte("bad"), 0600)
			}
			if state == "unknown" {
				e.cfg.Model = "invalid"
			}
			e.Startup()
			finishModelOperation(t, e)
			want := "base"
			if state == "saved" {
				want = "small"
			}
			if e.cfg.Model != want || e.currentModel != e.models.LocalPath(mustModel(want)) || !e.isLoaded() {
				t.Fatalf("startup failed: %s %s", e.cfg.Model, out.String())
			}
			if len(*calls) != 0 {
				t.Fatalf("downloaded despite verified cache: %v", *calls)
			}
			if state != "saved" && config.Load().Model != want {
				t.Fatal("fallback was not persisted")
			}
			if state == "corrupt" && e.modelItem("small").Status != "failed" {
				t.Fatal("corrupt cache not reported")
			}
			if e.modelItem("tiny").Downloaded {
				t.Fatal("missing cache reported downloaded")
			}
		})
	}
}

func TestStartupWaitsForUserChoiceWhenNoCache(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e, calls := lifecycleFixture(t, &out)
	e.cfg.Model = "small"
	e.Startup()
	finishModelOperation(t, e)
	if len(*calls) != 0 || e.cfg.Model != "small" || e.isLoaded() {
		t.Fatalf("startup did not wait for user choice: %v", *calls)
	}
	for _, item := range e.modelItems {
		if item.Downloaded || item.Active || item.Status != "not_downloaded" {
			t.Fatalf("missing model reported available: %+v", item)
		}
	}
	if bytes.Contains(out.Bytes(), []byte(`"type":"error"`)) {
		t.Fatal("first launch without a model should not report an error")
	}
	e.Handle(protocol.Command{Cmd: protocol.CmdDownloadModel, Model: "small"})
	finishModelOperation(t, e)
	if len(*calls) != 1 || !e.modelItem("small").Downloaded || e.isLoaded() {
		t.Fatal("explicit download should cache the selected model without initializing")
	}
	e.loadModel("small")
	finishModelOperation(t, e)
	if !e.isLoaded() || !e.modelItem("small").Active {
		t.Fatal("selected model did not become active")
	}
}

func TestDownloadThenSelectSwitchDeleteAndPersist(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e, calls := lifecycleFixture(t, &out)
	writeModel(t, e, "base")
	e.Startup()
	finishModelOperation(t, e)
	e.Handle(protocol.Command{Cmd: protocol.CmdLoadModel, Model: "small"})
	finishModelOperation(t, e)
	if len(*calls) != 0 || e.cfg.Model != "base" || e.modelItem("small").Downloaded {
		t.Fatal("selection auto-downloaded missing model")
	}
	e.Handle(protocol.Command{Cmd: protocol.CmdDownloadModel, Model: "small"})
	finishModelOperation(t, e)
	if e.cfg.Model != "base" || !e.modelItem("small").Downloaded {
		t.Fatal("download changed active selection or failed")
	}
	if !bytes.Contains(out.Bytes(), []byte(`"receivedBytes"`)) {
		t.Fatal("missing byte progress")
	}
	e.loadModel("small")
	finishModelOperation(t, e)
	if e.cfg.Model != "small" || config.Load().Model != "small" || !e.modelItem("small").Active {
		t.Fatal("switch not persisted")
	}
	e.prepareModel = func(string, bool) (*whisper.Engine, error) { t.Fatal("active model was reloaded"); return nil, nil }
	e.loadModel("small")
	e.deleteModel("small")
	if e.isLoaded() || e.currentModel != "" || e.modelItem("small").Active || e.modelItem("small").Downloaded {
		t.Fatal("deleting active model did not release context and clear inventory")
	}
	if _, err := os.Stat(e.models.LocalPath(mustModel("small"))); !os.IsNotExist(err) {
		t.Fatal("active model file was not removed")
	}
	e.deleteModel("base")
	e.deleteModel("base")
	if e.modelItem("base").Status != "not_downloaded" {
		t.Fatal("deletion not reflected")
	}
	if _, err := os.Stat(e.models.LocalPath(mustModel("base"))); !os.IsNotExist(err) {
		t.Fatal("cached base not removed")
	}
}

func TestInitializationAndSaveFailureKeepOldModel(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e, _ := lifecycleFixture(t, &out)
	writeModel(t, e, "base")
	writeModel(t, e, "small")
	e.Startup()
	finishModelOperation(t, e)
	old := e.wctx
	e.prepareModel = func(string, bool) (*whisper.Engine, error) { return nil, fmt.Errorf("init failed") }
	e.loadModel("small")
	finishModelOperation(t, e)
	if e.wctx != old || e.cfg.Model != "base" || !e.isLoaded() || !e.modelItem("small").Downloaded {
		t.Fatal("failed initialization replaced usable context")
	}
	if !strings.Contains(e.modelItem("small").Error, "initialize") {
		t.Fatal("missing friendly initialization error")
	}

	e.prepareModel = func(string, bool) (*whisper.Engine, error) { return &whisper.Engine{}, nil }
	if err := os.WriteFile(os.Getenv("HOME")+"/.clefvoice", []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	e.loadModel("small")
	finishModelOperation(t, e)
	if e.wctx != old || e.cfg.Model != "base" || !e.modelItem("base").Active {
		t.Fatal("failed settings save replaced active model")
	}
	if !strings.Contains(e.modelItem("small").Error, "save model choice") {
		t.Fatal("save failure not shown")
	}
}

func TestBusyCommandsCannotMutateModels(t *testing.T) {
	for _, state := range []string{"loading", "recording", "transcribing"} {
		t.Run(state, func(t *testing.T) {
			t.Setenv("HOME", t.TempDir())
			var out bytes.Buffer
			e, calls := lifecycleFixture(t, &out)
			writeModel(t, e, "small")
			e.loading, e.recording, e.transcribing = state == "loading", state == "recording", state == "transcribing"
			for _, cmd := range []string{protocol.CmdLoadModel, protocol.CmdDeleteModel, protocol.CmdDownloadModel} {
				e.Handle(protocol.Command{Cmd: cmd, Model: "small"})
			}
			if e.cfg.Model != "base" || len(*calls) != 0 || e.models.Verify(context.Background(), mustModel("small")) != nil {
				t.Fatal("busy command mutated model")
			}
			if bytes.Contains(out.Bytes(), []byte(`"type":"error"`)) {
				t.Fatal("busy command replaced current status")
			}
			e.loading = false
		})
	}
}

func TestLoadFailureDoesNotLoseConcurrentConfigChanges(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e, _ := lifecycleFixture(t, &out)
	writeModel(t, e, "small")
	entered, release := make(chan struct{}), make(chan struct{})
	e.prepareModel = func(string, bool) (*whisper.Engine, error) { close(entered); <-release; return &whisper.Engine{}, nil }
	e.loadModel("small")
	<-entered
	e.setConfig(json.RawMessage(`{"languages":["en"],"vad_enabled":false}`))
	close(release)
	finishModelOperation(t, e)
	saved := config.Load()
	if saved.Model != "small" || len(saved.Languages) != 1 || saved.Languages[0] != "en" || saved.VADEnabled {
		t.Fatalf("lost config update: %+v", saved)
	}
}

func TestDownloadFailureRemainsUnavailableAndRetryDoesNotSelect(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e, _ := lifecycleFixture(t, &out)
	writeModel(t, e, "base")
	e.Startup()
	finishModelOperation(t, e)
	transport := e.models.Client.Transport
	e.models.Client.Transport = modelTransport(func(*http.Request) (*http.Response, error) { return nil, fmt.Errorf("network disconnected") })
	e.Handle(protocol.Command{Cmd: protocol.CmdDownloadModel, Model: "small"})
	finishModelOperation(t, e)
	item := e.modelItem("small")
	if item.Status != "failed" || item.Downloaded || item.Error == "" || e.cfg.Model != "base" || !e.isLoaded() {
		t.Fatalf("incorrect failed download state: %+v", item)
	}
	e.models.Client.Transport = transport
	e.Handle(protocol.Command{Cmd: protocol.CmdDownloadModel, Model: "small"})
	finishModelOperation(t, e)
	if !e.modelItem("small").Downloaded || e.modelItem("small").Error != "" || e.cfg.Model != "base" {
		t.Fatal("retry did not restore availability without changing selection")
	}
}

func TestStartupUsesOtherCacheWhenDefaultIsCorrupt(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e, calls := lifecycleFixture(t, &out)
	e.cfg.Model = "small"
	writeModel(t, e, "tiny")
	if err := os.WriteFile(e.models.LocalPath(mustModel("base")), []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	e.Startup()
	finishModelOperation(t, e)
	if e.cfg.Model != "tiny" || config.Load().Model != "tiny" || len(*calls) != 0 || e.modelItem("base").Downloaded {
		t.Fatal("failed to choose verified alternative cache")
	}
}

func TestDeleteFailurePreservesModelInventory(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e, _ := lifecycleFixture(t, &out)
	path := e.models.LocalPath(mustModel("small"))
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	e.Startup()
	finishModelOperation(t, e)
	e.deleteModel("small")
	item := e.modelItem("small")
	if !item.Present || !strings.Contains(item.Error, "Could not delete") {
		t.Fatalf("delete failure was hidden: %+v", item)
	}
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		t.Fatal("unsafe delete changed model path")
	}
}

func TestDeleteLastModelAndRestartDoesNotDownloadAgain(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e, calls := lifecycleFixture(t, &out)
	writeModel(t, e, "base")
	e.Startup()
	finishModelOperation(t, e)
	e.deleteModel("base")
	e.deleteModel("base")
	if e.isLoaded() || e.modelItem("base").Present || e.modelItem("base").Active {
		t.Fatal("last model was not fully removed")
	}
	e.Startup()
	finishModelOperation(t, e)
	if e.isLoaded() || len(*calls) != 0 {
		t.Fatal("restart restored a deleted model without user consent")
	}
}

func TestFailedActiveDeletionKeepsUsableContext(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e, _ := lifecycleFixture(t, &out)
	writeModel(t, e, "base")
	e.Startup()
	finishModelOperation(t, e)
	loaded := e.wctx
	path := e.models.LocalPath(mustModel("base"))
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	e.deleteModel("base")
	if e.wctx != loaded || !e.isLoaded() || !e.modelItem("base").Active || e.modelItem("base").Error == "" {
		t.Fatal("failed deletion discarded the active context or hid the error")
	}
}
