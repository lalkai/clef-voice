package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/clefvoice/core/internal/capture"
	"github.com/clefvoice/core/internal/config"
	"github.com/clefvoice/core/internal/dsp"
	"github.com/clefvoice/core/internal/history"
	"github.com/clefvoice/core/internal/lang"
	"github.com/clefvoice/core/internal/models"
	"github.com/clefvoice/core/internal/noise"
	"github.com/clefvoice/core/internal/postprocess"
	"github.com/clefvoice/core/internal/protocol"
	"github.com/clefvoice/core/internal/vad"
	"github.com/clefvoice/core/internal/whisper"
)

// TargetSampleRate is the fixed sample rate of the pipeline (16 kHz).
const TargetSampleRate = 16000

type loadMsg struct {
	status   string
	message  string
	progress float64
	done     bool
	err      error
}

type transcribeMsg struct {
	text string
	err  error
}

// Engine owns the recognition pipeline: audio capture, VAD, whisper and
// post-processing.
type Engine struct {
	emit *protocol.Emitter

	whisperMu    sync.Mutex
	wctx         *whisper.Engine
	currentModel string

	models *models.Manager
	cfg    config.Config
	post   *postprocess.Processor
	vad    *vad.Detector
	hist   *history.Store

	recording bool
	capture   *capture.Session
	session   []float32

	loading      bool
	loadingModel string
	loadStatus   string
	loadMessage  string
	loadProgress float64
	loadError    string
	loadCancel   context.CancelFunc
	loadWG       sync.WaitGroup
	loadCh       chan loadMsg

	transcribing        bool
	transcribeSamples   int
	transcribeCh        chan transcribeMsg
	transcribeStarted   time.Time
	transcribeModel     string
	transcribeLanguages []string
	transcribePost      *postprocess.Processor
}

// New creates an Engine with the given model directory override.
func New(modelsDir string, emit *protocol.Emitter) *Engine {
	cfg := config.Load()
	return &Engine{
		emit:   emit,
		models: models.NewManager(modelsDir),
		cfg:    cfg,
		post:   postprocess.New(cfg.RemoveFiller, cfg.AutoCapitalize),
		vad:    vad.NewDetector(cfg.VADThreshold),
		hist:   history.NewStore(),
	}
}

// GetConfig returns the current configuration.
func (e *Engine) GetConfig() config.Config {
	return e.cfg
}

// Handle processes a command. Returns true when the process should shut down.
func (e *Engine) Handle(cmd protocol.Command) bool {
	switch cmd.Cmd {
	case protocol.CmdPing:
		e.Handle(protocol.Command{Cmd: protocol.CmdGetState})
		e.emit.Config(e.cfg)
	case protocol.CmdGetConfig:
		e.emit.Config(e.cfg)
	case protocol.CmdGetState:
		if e.loading {
			e.emit.Status(e.loadStatus, e.loadMessage)
			e.emit.ModelProgress(e.loadingModel, e.loadProgress, e.loadStatus == "downloading")
		} else if e.recording {
			e.emit.Status("recording", "Listening...")
		} else if e.transcribing {
			e.emit.Status("transcribing", "Transcribing...")
		} else if e.loadError != "" {
			e.emit.Error(e.loadError)
		} else if e.isLoaded() {
			e.emit.Status("idle", fmt.Sprintf("Model '%s' ready.", e.cfg.Model))
		} else {
			e.emit.Status("loading", "Model not loaded.")
		}
	case protocol.CmdSetConfig:
		e.setConfig(cmd.Config)
	case protocol.CmdLoadModel:
		e.loadModel(cmd.Model)
	case protocol.CmdStart:
		e.StartRecording()
	case protocol.CmdStop:
		e.StopRecording()
	case protocol.CmdToggle:
		if e.recording {
			e.StopRecording()
		} else {
			e.StartRecording()
		}
	case protocol.CmdGetHistory:
		e.emit.History(e.hist.GetHistory())
	case protocol.CmdGetStats:
		e.emit.Stats(e.hist.GetStats())
	case protocol.CmdClearHistory:
		if err := e.hist.Clear(); err != nil {
			e.emit.Error("Could not clear history: " + err.Error())
			e.emit.History(e.hist.GetHistory())
			return false
		}
		e.emit.History(e.hist.GetHistory())
		e.emit.Stats(e.hist.GetStats())
	case protocol.CmdDeleteHistory:
		if err := e.hist.Delete(cmd.ID); err != nil {
			e.emit.Error("Could not delete history item: " + err.Error())
			e.emit.History(e.hist.GetHistory())
			return false
		}
		e.emit.History(e.hist.GetHistory())
		e.emit.Stats(e.hist.GetStats())
	case protocol.CmdShutdown:
		return true
	case protocol.CmdSetHistoryFavorite:
		if err := e.hist.SetFavorite(cmd.ID, cmd.Favorite); err != nil {
			e.emit.Error("Could not update favorite: " + err.Error())
		}
		e.emit.History(e.hist.GetHistory())
	}
	return false
}

func (e *Engine) setConfig(raw json.RawMessage) {
	cfg := e.cfg
	// json.Unmarshal may reuse slice storage. Keep the live config unchanged
	// until the entire patch has been validated and saved.
	cfg.Languages = append([]string(nil), e.cfg.Languages...)
	cfg.CustomVocabulary = append([]string(nil), e.cfg.CustomVocabulary...)
	if err := json.Unmarshal(raw, &cfg); err != nil {
		e.emit.Error("Invalid configuration.")
		return
	}
	if _, ok := models.FromStr(cfg.Model); !ok {
		e.emit.Error("Unknown model.")
		return
	}
	if e.loading || e.recording || e.transcribing {
		cfg.Model = e.cfg.Model
	}
	modelChanged := cfg.Model != e.cfg.Model
	if err := config.Save(cfg); err != nil {
		e.emit.Error("Could not save settings: " + err.Error())
		e.emit.Config(e.cfg)
		return
	}
	e.cfg = cfg
	e.vad = vad.NewDetector(cfg.VADThreshold)
	e.post = postprocess.New(cfg.RemoveFiller, cfg.AutoCapitalize)
	e.emit.Config(e.cfg)
	if modelChanged {
		e.loadModel(cfg.Model)
	}
}

func (e *Engine) loadModel(model string) {
	size, ok := models.FromStr(model)
	if !ok {
		e.emit.Error(fmt.Sprintf("unknown model: %s", model))
		return
	}
	if e.loading {
		// Repeated clicks for the same model are idempotent. Do not interrupt a load.
		e.Handle(protocol.Command{Cmd: protocol.CmdGetState})
		return
	}
	if e.recording || e.transcribing {
		// Keep the active session and its context intact.
		e.Handle(protocol.Command{Cmd: protocol.CmdGetState})
		return
	}
	if model != e.cfg.Model {
		cfg := e.cfg
		cfg.Model = model
		if err := config.Save(cfg); err != nil {
			e.emit.Error("Could not save model choice: " + err.Error())
			e.emit.Config(e.cfg)
			return
		}
		e.cfg = cfg
	}
	e.emit.Config(e.cfg)
	e.loadError = ""
	if e.isLoaded() && e.currentModel == e.models.LocalPath(size) {
		e.emit.ModelLoaded(model)
		e.emit.Status("idle", fmt.Sprintf("Model '%s' ready.", model))
		return
	}
	e.loading = true
	e.loadingModel = model
	e.loadStatus = "loading"
	e.loadMessage = fmt.Sprintf("Verifying %s model...", model)
	e.loadProgress = 0
	e.emit.Status(e.loadStatus, e.loadMessage)
	ch := make(chan loadMsg, 64)
	e.loadCh = ch
	ctx, cancel := context.WithCancel(context.Background())
	e.loadCancel = cancel
	useGPU := e.cfg.UseGPU
	e.loadWG.Add(1)
	go func() {
		defer e.loadWG.Done()
		send := func(msg loadMsg) {
			select {
			case ch <- msg:
			case <-ctx.Done():
			}
		}
		defer func() {
			if r := recover(); r != nil {
				send(loadMsg{done: true, err: fmt.Errorf("load panic: %v", r)})
			}
		}()
		path, err := e.models.DownloadContext(ctx, size, func(p float64) {
			select {
			case ch <- loadMsg{status: "downloading", progress: p}:
			default:
			}
		})
		if err != nil {
			send(loadMsg{done: true, err: err})
			return
		}
		if ctx.Err() != nil {
			return
		}
		send(loadMsg{status: "loading", message: fmt.Sprintf("Initializing %s model...", model)})
		err = e.loadWhisper(path, useGPU)
		if err != nil && useGPU && ctx.Err() == nil {
			log.Printf("clefd: GPU load failed (%v); retrying on CPU", err)
			send(loadMsg{status: "loading", message: fmt.Sprintf("Initializing %s model on CPU...", model)})
			err = e.loadWhisper(path, false)
		}
		send(loadMsg{done: true, err: err})
	}()
}

func (e *Engine) StartRecording() {
	if e.recording {
		return
	}
	if e.loading {
		e.Handle(protocol.Command{Cmd: protocol.CmdGetState})
		return
	}
	if e.transcribing {
		e.emit.Error("Still transcribing.")
		return
	}
	size, valid := models.FromStr(e.cfg.Model)
	if !e.isLoaded() || !valid || e.currentModel != e.models.LocalPath(size) {
		e.loadModel(e.cfg.Model)
		return
	}

	s, err := capture.Start()
	if err != nil {
		e.emit.Error(fmt.Sprintf("Microphone unavailable: %v", err))
		return
	}
	e.capture = s
	e.session = e.session[:0]
	e.vad.ResetAutoStop()
	e.recording = true
	e.emit.Status("recording", "Listening...")
}

func (e *Engine) StopRecording() {
	if !e.recording {
		return
	}
	e.recording = false
	e.transcribeStarted = time.Now()

	if s := e.capture; s != nil {
		// Stop the producer before draining so the final audio chunk is retained.
		s.Stop()
	drain:
		for {
			select {
			case chunk := <-s.Ch:
				e.session = append(e.session, chunk...)
			default:
				break drain
			}
		}
		e.capture = nil
	}

	raw := e.session
	e.session = nil

	var samples []float32
	if e.cfg.VADEnabled {
		trimmed := e.vad.TrimSilence(raw)
		if len(trimmed) > 1600 {
			samples = trimmed
		} else {
			e.emit.Status("idle", "No speech detected.")
			return
		}
	} else {
		rms := dsp.RMS(raw)
		if rms < 0.004 {
			e.emit.Status("idle", "No speech detected.")
			return
		}
		samples = raw
	}

	if len(samples) <= 800 {
		e.emit.Status("idle", "Too short. Speak longer.")
		return
	}
	if !e.isLoaded() {
		e.emit.Error("Model not loaded.")
		return
	}

	e.emit.Status("transcribing", "Transcribing...")

	filtered := noise.Process(samples)
	codes := append([]string(nil), e.cfg.Languages...)
	e.transcribeLanguages = codes
	e.transcribeModel = e.cfg.Model
	e.transcribePost = e.post
	var prompt string
	if len(e.cfg.CustomVocabulary) > 0 {
		prompt = strings.Join(e.cfg.CustomVocabulary, ", ")
	}
	// Include pauses and leading/trailing silence in the dictation duration.
	e.transcribeSamples = len(raw)
	e.transcribing = true
	e.transcribeCh = make(chan transcribeMsg, 1)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				e.transcribeCh <- transcribeMsg{err: fmt.Errorf("transcription panic: %v", r)}
			}
		}()
		text, err := e.transcribe(filtered, codes, prompt)
		e.transcribeCh <- transcribeMsg{text: text, err: err}
	}()
}

// PollLoad drains pending model-load messages.
func (e *Engine) PollLoad() {
	if !e.loading {
		return
	}
	model := e.loadingModel
	for {
		var msg loadMsg
		select {
		case msg = <-e.loadCh:
		default:
			return
		}
		if msg.done {
			e.loading = false
			e.loadCancel()
			e.loadCancel = nil
			e.loadCh = nil
			e.loadingModel = ""
			if msg.err != nil {
				e.loadError = msg.err.Error()
				e.emit.Error(msg.err.Error())
			} else {
				e.emit.ModelProgress(model, 1.0, false)
				e.emit.ModelLoaded(model)
				e.emit.Status("idle", fmt.Sprintf("Model '%s' ready.", model))
			}
			return
		}
		if msg.status == "loading" {
			e.loadStatus, e.loadMessage = msg.status, msg.message
			e.emit.Status(e.loadStatus, e.loadMessage)
			e.emit.ModelProgress(model, 1, false)
		} else {
			if e.loadStatus != "downloading" {
				e.loadStatus = "downloading"
				e.loadMessage = fmt.Sprintf("Downloading %s model...", model)
				e.emit.Status(e.loadStatus, e.loadMessage)
			}
			e.loadProgress = msg.progress
			e.emit.ModelProgress(model, msg.progress, true)
		}
	}
}

// PollTranscribe drains a pending transcription result.
func (e *Engine) PollTranscribe() {
	if !e.transcribing {
		return
	}
	select {
	case msg := <-e.transcribeCh:
		e.transcribing = false
		e.transcribeCh = nil
		if msg.err != nil {
			e.emit.Error(msg.err.Error())
		} else {
			e.finalize(msg.text)
		}
	default:
	}
}

func (e *Engine) finalize(text string) {
	processor := e.transcribePost
	if processor == nil {
		processor = e.post
	}
	finalText := processor.Process(text)
	if finalText == "" {
		e.emit.Status("idle", "No speech detected.")
		return
	}

	wpm := computeWPM(text, e.transcribeSamples)
	langCode := "Auto"
	languages := e.transcribeLanguages
	if e.transcribeStarted.IsZero() {
		languages = e.cfg.Languages
	}
	if len(languages) > 0 {
		langCode = strings.Join(languages, ",")
	}
	var historyErr error
	if e.transcribeStarted.IsZero() {
		historyErr = e.hist.AddMeasured(finalText, langCode, wpm, postprocess.WordCount(text), float64(e.transcribeSamples)/TargetSampleRate)
	} else {
		historyErr = e.hist.AddResult(finalText, langCode, wpm, postprocess.WordCount(text), float64(e.transcribeSamples)/TargetSampleRate, time.Since(e.transcribeStarted).Seconds(), e.transcribeModel)
	}
	e.emit.Transcribed(finalText, wpm, langCode, e.transcribeSamples)
	if historyErr != nil {
		log.Printf("Could not save transcription history: %v", historyErr)
		e.emit.Status("idle", "Transcript was not saved to History.")
	}
}

// IsRecording reports whether a capture session is active.
func (e *Engine) IsRecording() bool { return e.recording }

// DrainAudio pulls pending audio chunks into the session buffer.
func (e *Engine) DrainAudio() {
	if e.capture == nil {
		return
	}
	for {
		select {
		case chunk := <-e.capture.Ch:
			e.session = append(e.session, chunk...)
		default:
			return
		}
	}
}

// CurrentLevel returns the smoothed audio level.
func (e *Engine) CurrentLevel() float32 {
	if e.capture == nil {
		return 0
	}
	return e.capture.Level()
}

// AutoStopCheck reports whether trailing silence should end the session.
func (e *Engine) AutoStopCheck() bool {
	if !e.recording || !e.cfg.AutoStopEnabled {
		return false
	}
	return e.vad.ShouldAutoStop(e.session, e.cfg.AutoStopSeconds)
}

// Shutdown releases the whisper context.
func (e *Engine) Shutdown() {
	if e.loadCancel != nil {
		e.loadCancel()
	}
	e.loadWG.Wait()
	e.unload()
}

// --- whisper access (serialized by whisperMu) ---

func (e *Engine) isLoaded() bool {
	e.whisperMu.Lock()
	defer e.whisperMu.Unlock()
	return e.wctx != nil
}

func (e *Engine) loadWhisper(path string, useGPU bool) error {
	w, err := whisper.NewEngine(path, useGPU)
	if err != nil {
		return err
	}
	e.whisperMu.Lock()
	if e.wctx != nil {
		e.wctx.Close()
	}
	e.wctx = w
	e.currentModel = path
	e.whisperMu.Unlock()
	return nil
}

func (e *Engine) unload() {
	e.whisperMu.Lock()
	if e.wctx != nil {
		e.wctx.Close()
		e.wctx = nil
	}
	e.currentModel = ""
	e.whisperMu.Unlock()
}

func (e *Engine) transcribe(samples []float32, codes []string, prompt string) (string, error) {
	langCode := lang.ResolveLanguage(codes)

	e.whisperMu.Lock()
	defer e.whisperMu.Unlock()
	if e.wctx == nil {
		return "", errors.New("model is not loaded")
	}
	return e.wctx.Transcribe(samples, langCode, prompt, nThreads())
}

func nThreads() int {
	cpus := runtime.NumCPU()
	n := cpus / 2
	if n < 4 {
		n = 4
	}
	if n > 8 {
		n = 8
	}
	return n
}

func computeWPM(text string, samples int) float64 {
	if samples <= 0 {
		return 0
	}
	duration := float64(samples) / float64(TargetSampleRate)
	return float64(postprocess.WordCount(text)) / (duration / 60.0)
}
