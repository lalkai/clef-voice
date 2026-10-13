package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/clefvoice/core/internal/config"
	"github.com/clefvoice/core/internal/history"
	"github.com/clefvoice/core/internal/postprocess"
	"github.com/clefvoice/core/internal/protocol"
)

func TestComputeWPM(t *testing.T) {
	for _, tt := range []struct {
		text    string
		samples int
		want    float64
	}{
		{"one two three four", 2 * TargetSampleRate, 120},
		{"one two three four", 4 * TargetSampleRate, 60},
		{"", TargetSampleRate, 0},
		{"one", 0, 0},
		{"one", -1, 0},
	} {
		if got := computeWPM(tt.text, tt.samples); got != tt.want {
			t.Fatalf("%+v: got %v", tt, got)
		}
	}
}
func TestModelLoadingPhases(t *testing.T) {
	var out bytes.Buffer
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	e := &Engine{emit: protocol.NewEmitter(&out), loading: true, loadingModel: "base", loadStatus: "loading", loadCancel: cancel, loadCh: make(chan loadMsg, 4)}
	e.loadCh <- loadMsg{status: "downloading", progress: .5}
	e.loadCh <- loadMsg{status: "loading", message: "Initializing base model..."}
	e.PollLoad()
	if e.loadStatus != "loading" || !e.loading {
		t.Fatal("initialization reported ready")
	}
	if !bytes.Contains(out.Bytes(), []byte(`"downloading":false`)) {
		t.Fatal("download phase never ended")
	}
	e.loadCh <- loadMsg{done: true, operation: "initialization", err: errors.New("init failed")}
	e.PollLoad()
	if e.loading || e.loadError != modelError("initialization", errors.New("init failed")) || ctx.Err() == nil {
		t.Fatal("failure did not reset load")
	}
	out.Reset()
	e.Handle(protocol.Command{Cmd: protocol.CmdGetState})
	if !bytes.Contains(out.Bytes(), []byte("Could not initialize")) {
		t.Fatal("late subscriber lost error")
	}
}
func TestBusyModelRequestsKeepCurrentSelection(t *testing.T) {
	for _, state := range []string{"loading", "recording", "transcribing"} {
		t.Run(state, func(t *testing.T) {
			var out bytes.Buffer
			e := &Engine{emit: protocol.NewEmitter(&out), cfg: config.Default(), loading: state == "loading", recording: state == "recording", transcribing: state == "transcribing", loadStatus: "loading", loadingModel: "base"}
			e.loadModel("small")
			if e.cfg.Model != "base" {
				t.Fatal("busy request changed selection")
			}
			if bytes.Contains(out.Bytes(), []byte(`"type":"error"`)) {
				t.Fatal("busy request replaced progress with an error")
			}
		})
	}
}
func TestConfigCannotChangeModelWhileLoading(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e := &Engine{emit: protocol.NewEmitter(&out), cfg: config.Default(), loading: true}
	e.setConfig(json.RawMessage(`{"model":"small","auto_stop_enabled":false}`))
	if e.cfg.Model != "base" || e.cfg.AutoStopEnabled {
		t.Fatal("patch did not preserve loading model and apply unrelated setting")
	}
}

func TestVoiceAudioChangesPersistWhileModelIsLoading(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e := &Engine{emit: protocol.NewEmitter(&out), cfg: config.Default(), loading: true}
	e.Handle(protocol.Command{Cmd: protocol.CmdSetConfig, Config: json.RawMessage(`{"vad_enabled":false,"vad_threshold":0.025,"auto_stop_enabled":true,"auto_stop_seconds":1.2}`)})
	saved := config.Load()
	if saved.VADEnabled || saved.VADThreshold != .025 || !saved.AutoStopEnabled || saved.AutoStopSeconds != 1.2 || saved.Model != "base" {
		t.Fatalf("audio settings did not persist: %+v", saved)
	}
	if !bytes.Contains(out.Bytes(), []byte(`"vad_threshold":0.025`)) {
		t.Fatalf("saved sensitivity was not acknowledged: %s", out.String())
	}
}

func TestFavoriteCommandPublishesSavedHistory(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e := &Engine{emit: protocol.NewEmitter(&out), cfg: config.Default(), hist: history.NewStore()}
	if err := e.hist.Add("hello", "en", 120); err != nil {
		t.Fatal(err)
	}
	id := e.hist.GetHistory()[0].ID
	e.Handle(protocol.Command{Cmd: protocol.CmdSetHistoryFavorite, ID: id, Favorite: true})
	if !bytes.Contains(out.Bytes(), []byte(`"favorite":true`)) || !history.NewStore().GetHistory()[0].Favorite {
		t.Fatalf("favorite was not persisted and published: %s", out.String())
	}
}

func TestCustomVocabularyUpdateIsAppliedAndPersisted(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e := &Engine{emit: protocol.NewEmitter(&out), cfg: config.Default()}
	e.setConfig(json.RawMessage(`{"custom_vocabulary":["ClefVoice","ขมิ้น","Kubernetes"]}`))
	want := []string{"ClefVoice", "ขมิ้น", "Kubernetes"}
	if !reflect.DeepEqual(e.cfg.CustomVocabulary, want) {
		t.Fatalf("engine vocabulary = %q, want %q", e.cfg.CustomVocabulary, want)
	}
	if !reflect.DeepEqual(config.Load().CustomVocabulary, want) {
		t.Fatalf("saved vocabulary was not restored")
	}
	if !bytes.Contains(out.Bytes(), []byte(`"custom_vocabulary":["ClefVoice","ขมิ้น","Kubernetes"]`)) {
		t.Fatalf("engine did not publish updated vocabulary: %s", out.String())
	}
}

func TestCustomVocabularyUpdateReportsSaveFailure(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := os.WriteFile(filepath.Join(home, ".clefvoice"), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	e := &Engine{emit: protocol.NewEmitter(&out), cfg: config.Default()}
	e.setConfig(json.RawMessage(`{"custom_vocabulary":["ขมิ้น"]}`))
	if !reflect.DeepEqual(e.cfg.CustomVocabulary, config.Default().CustomVocabulary) {
		t.Fatal("unsaved vocabulary was applied")
	}
	if !bytes.Contains(out.Bytes(), []byte("Could not save settings")) {
		t.Fatalf("save failure was not reported: %s", out.String())
	}
	if !bytes.Contains(out.Bytes(), []byte(`"custom_vocabulary":["ClefVoice","TypeScript","TailwindCSS"]`)) {
		t.Fatalf("previous vocabulary was not sent back to the UI: %s", out.String())
	}
}

func TestModelChoiceIsNotAppliedWhenSavingFails(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := os.WriteFile(filepath.Join(home, ".clefvoice"), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	e, _ := lifecycleFixture(t, &out)
	writeModel(t, e, "small")
	e.loadModel("small")
	finishModelOperation(t, e)
	if e.cfg.Model != "base" || e.loading {
		t.Fatalf("unsaved model choice was applied: model=%q loading=%t", e.cfg.Model, e.loading)
	}
	if !bytes.Contains(out.Bytes(), []byte("Could not save model choice")) ||
		!bytes.Contains(out.Bytes(), []byte(`"model":"base"`)) {
		t.Fatalf("save failure was not reported with the current config: %s", out.String())
	}
}

func TestFinalizationMeasuresSpeechBeforePostprocessing(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e := &Engine{emit: protocol.NewEmitter(&out), cfg: config.Default(), hist: history.NewStore(), transcribeSamples: 2 * TargetSampleRate,
		post: postprocess.New(true, false)}
	e.finalize("um hello")
	item := e.hist.GetHistory()[0]
	if item.Text != "hello" || item.WordCount != 1 || item.WPM != 60 || *item.SpokenWords != 2 || item.DurationSeconds != 2 {
		t.Fatalf("incorrect speech metrics: %+v", item)
	}
}

func TestFinalizationUsesSessionSnapshotAndRecordsProcessingTime(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e := &Engine{emit: protocol.NewEmitter(&out), cfg: config.Default(), hist: history.NewStore(), transcribeSamples: TargetSampleRate,
		post: postprocess.New(false, true), transcribePost: postprocess.New(true, false),
		transcribeLanguages: []string{"en"}, transcribeModel: "small", transcribeStarted: time.Now().Add(-time.Second)}
	e.finalize("um hello")
	item := e.hist.GetHistory()[0]
	if item.Text != "hello" || item.Language != "en" || item.Model != "small" || item.ProcessingSeconds == nil || *item.ProcessingSeconds < 1 {
		t.Fatalf("session snapshot or timing lost: %+v", item)
	}
}

func TestFinalizationStillReturnsTranscriptWhenHistoryCannotBeSaved(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := os.WriteFile(filepath.Join(home, ".clefvoice"), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	e := &Engine{emit: protocol.NewEmitter(&out), cfg: config.Default(), hist: history.NewStore(), transcribeSamples: TargetSampleRate,
		post: postprocess.New(false, false)}
	e.finalize("hello")
	if !bytes.Contains(out.Bytes(), []byte(`"type":"transcribed"`)) ||
		!bytes.Contains(out.Bytes(), []byte("Transcript was not saved to History.")) {
		t.Fatalf("transcript or history warning missing: %s", out.String())
	}
	if len(e.hist.GetHistory()) != 0 {
		t.Fatal("failed history save appeared in memory")
	}
}

func TestSetConfigDuringTranscribeRace(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e := &Engine{
		emit: protocol.NewEmitter(&out),
		cfg:  config.Default(),
	}

	done := make(chan struct{})
	go func() {
		for {
			select {
			case <-done:
				return
			default:
				_, _ = e.transcribe(nil, nil, "")
			}
		}
	}()

	for i := 0; i < 50; i++ {
		e.setConfig(json.RawMessage(`{"custom_vocabulary":["term1","term2"]}`))
		e.setConfig(json.RawMessage(`{"custom_vocabulary":["term3"]}`))
	}
	close(done)
}

func TestHistoryFailureReEmitsCurrentHistory(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	var out bytes.Buffer
	e := &Engine{emit: protocol.NewEmitter(&out), cfg: config.Default(), hist: history.NewStore()}
	_ = e.hist.Add("item 1", "en", 120)

	// Block write access to simulate storage failure
	dir := filepath.Join(home, ".clefvoice")
	if err := os.Chmod(dir, 0500); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(dir, 0700)

	out.Reset()
	e.Handle(protocol.Command{Cmd: protocol.CmdClearHistory})
	if !bytes.Contains(out.Bytes(), []byte("Could not clear history")) {
		t.Fatalf("expected clear history error: %s", out.String())
	}
	if !bytes.Contains(out.Bytes(), []byte(`"type":"history"`)) || !bytes.Contains(out.Bytes(), []byte("item 1")) {
		t.Fatalf("expected current history re-emitted on clear failure: %s", out.String())
	}

	out.Reset()
	e.Handle(protocol.Command{Cmd: protocol.CmdDeleteHistory, ID: "any-id"})
	if !bytes.Contains(out.Bytes(), []byte(`"type":"history"`)) || !bytes.Contains(out.Bytes(), []byte("item 1")) {
		t.Fatalf("expected current history re-emitted on delete failure: %s", out.String())
	}
}

func TestInvalidAudioSettingsKeepRecordingAndReconcileConfig(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer
	e := &Engine{emit: protocol.NewEmitter(&out), cfg: config.Default(), recording: true}
	e.setConfig(json.RawMessage(`{"vad_threshold":0,"auto_stop_enabled":true}`))
	if !e.recording || !reflect.DeepEqual(e.cfg, config.Default()) {
		t.Fatal("invalid settings changed session")
	}
	if !bytes.Contains(out.Bytes(), []byte(`"recoverable":true`)) || !bytes.Contains(out.Bytes(), []byte(`"type":"config"`)) {
		t.Fatal(out.String())
	}
}

func TestSettingsReadReturnsAuthoritativeCorrelatedPayload(t *testing.T) {
	var out bytes.Buffer
	cfg := config.Default()
	cfg.Languages = []string{"ja"}
	cfg.VADEnabled = false
	e := &Engine{emit: protocol.NewEmitter(&out), cfg: cfg}
	e.Handle(protocol.Command{Cmd: protocol.CmdGetConfig, RequestID: "read-1"})
	var event struct {
		Type      string        `json:"type"`
		RequestID string        `json:"request_id"`
		Result    config.Config `json:"result"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(out.Bytes()), &event); err != nil {
		t.Fatal(err)
	}
	if event.Type != "command_result" || event.RequestID != "read-1" || !reflect.DeepEqual(event.Result, cfg) {
		t.Fatalf("wrong read result: %+v", event)
	}
	out.Reset()
	e.Handle(protocol.Command{Cmd: protocol.CmdGetConfig})
	if !bytes.Contains(out.Bytes(), []byte(`"type":"config"`)) {
		t.Fatal("legacy event reads must remain supported")
	}
}

func TestLanguageReadWithoutRequestIDReportsError(t *testing.T) {
	var out bytes.Buffer
	e := &Engine{emit: protocol.NewEmitter(&out)}
	e.Handle(protocol.Command{Cmd: protocol.CmdGetLanguages})
	if !bytes.Contains(out.Bytes(), []byte("get_languages requires a request_id")) {
		t.Fatal("missing request ID must not silently discard the language read")
	}
}
