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
	status    string
	message   string
	progress  float64
	done      bool
	err       error
	items     []modelItem
	model     string
	operation string
	received  int64
	total     int64
	prepared  *whisper.Engine
}

type transcribeMsg struct {
	text string
	err  error
}

// Engine owns the recognition pipeline: audio capture, VAD, whisper and
// post-processing.
type Engine struct {
	emit                 *protocol.Emitter
	commandRequestActive bool
	requestError         string
	modelRequestID       string
	modelOperation       string

	whisperMu    sync.Mutex
	wctx         *whisper.Engine
	currentModel string

	modelItems   []modelItem
	prepareModel func(string, bool) (*whisper.Engine, error)
	models       *models.Manager
	cfg          config.Config
	post         *postprocess.Processor
	vad          *vad.Detector
	hist         *history.Store

	recordingSessionID string
	recording          bool
	capture            *capture.Session
	session            []float32

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
func (e *Engine) operationError(message string) {
	e.requestError = message
	if !e.commandRequestActive {
		e.emit.OperationError(message)
	}
}

func (e *Engine) Handle(cmd protocol.Command) bool {
	if cmd.RequestID == "" {
		return e.handle(cmd)
	}
	modelMutation := cmd.Cmd == protocol.CmdDownloadModel || cmd.Cmd == protocol.CmdLoadModel || cmd.Cmd == protocol.CmdDeleteModel
	if modelMutation {
		if _, ok := models.FromStr(cmd.Model); !ok {
			e.emit.Result(cmd.RequestID, "failed", "Unknown model.")
			return false
		}
		if e.loading || e.recording || e.transcribing {
			e.emit.Result(cmd.RequestID, "busy", "Engine is busy. Please retry when idle.")
			return false
		}
	}
	e.requestError = ""
	e.commandRequestActive = true
	shutdown := e.handle(cmd)
	e.commandRequestActive = false
	if modelMutation && e.loading {
		e.modelRequestID = cmd.RequestID
		e.emit.Result(cmd.RequestID, "accepted", "")
	} else if e.requestError != "" {
		e.emit.Result(cmd.RequestID, "failed", e.requestError)
	} else {
		e.emit.Result(cmd.RequestID, "completed", "")
	}
	return shutdown
}

func (e *Engine) handle(cmd protocol.Command) bool {
	switch cmd.Cmd {
	case "input_error":
		e.operationError(cmd.ID)
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
			e.emit.Status("recording", "Listening...", e.recordingSessionID)
		} else if e.transcribing {
			e.emit.Status("transcribing", "Transcribing...", e.recordingSessionID)
		} else if e.loadError != "" {
			e.emit.Error(e.loadError)
		} else if e.isLoaded() {
			e.emit.Status("idle", fmt.Sprintf("Model '%s' ready.", e.cfg.Model))
		} else {
			e.emit.Status("idle", "Select a downloaded model to start dictating.")
		}
	case protocol.CmdSetConfig:
		e.setConfig(cmd.Config)
	case protocol.CmdGetModels:
		e.emitModels()
	case protocol.CmdCancelDownload:
		if e.loading && (e.modelOperation == "download" || e.modelOperation == "load" && strings.HasPrefix(e.loadMessage, "Verifying")) {
			if e.loadCancel != nil {
				e.loadCancel()
			}
		}
	case protocol.CmdDownloadModel:
		e.beginModelOperation("download", cmd.Model)
	case protocol.CmdDeleteModel:
		e.deleteModel(cmd.Model)
	case protocol.CmdLoadModel:
		e.loadModel(cmd.Model)
	case protocol.CmdStart:
		e.StartRecording(cmd.SessionID)
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
			e.operationError("Could not clear history: " + err.Error())
			e.emit.History(e.hist.GetHistory())
			return false
		}
		e.emit.History(e.hist.GetHistory())
		e.emit.Stats(e.hist.GetStats())
	case protocol.CmdDeleteHistory:
		if err := e.hist.Delete(cmd.ID); err != nil {
			e.operationError("Could not delete history item: " + err.Error())
			e.emit.History(e.hist.GetHistory())
			return false
		}
		e.emit.History(e.hist.GetHistory())
		e.emit.Stats(e.hist.GetStats())
	case protocol.CmdShutdown:
		return true
	case protocol.CmdSetHistoryFavorite:
		if err := e.hist.SetFavorite(cmd.ID, cmd.Favorite); err != nil {
			e.operationError("Could not update favorite: " + err.Error())
		}
		e.emit.History(e.hist.GetHistory())
	default:
		e.operationError("Unknown command.")
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
		e.operationError("Invalid configuration.")
		e.emit.Config(e.cfg)
		return
	}
	cfg.NormalizeVocabulary()
	if _, ok := models.FromStr(cfg.Model); !ok {
		e.operationError("Unknown model.")
		e.emit.Config(e.cfg)
		return
	}
	if e.loading || e.recording || e.transcribing {
		cfg.Model = e.cfg.Model
	}
	requestedModel := cfg.Model
	modelChanged := cfg.Model != e.cfg.Model
	cfg.Model = e.cfg.Model
	if err := config.Save(cfg); err != nil {
		e.operationError("Could not save settings: " + err.Error())
		e.emit.Config(e.cfg)
		return
	}
	e.cfg = cfg
	e.vad = vad.NewDetector(cfg.VADThreshold)
	e.post = postprocess.New(cfg.RemoveFiller, cfg.AutoCapitalize)
	e.emit.Config(e.cfg)
	if modelChanged {
		e.loadModel(requestedModel)
	}
}

func (e *Engine) StartRecording(sessionIDs ...string) {
	if e.recording {
		return
	}
	if e.loading {
		e.Handle(protocol.Command{Cmd: protocol.CmdGetState})
		return
	}
	if e.transcribing {
		e.emit.Status("transcribing", "Transcribing...", e.recordingSessionID)
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
	e.recordingSessionID = ""
	if len(sessionIDs) > 0 {
		e.recordingSessionID = sessionIDs[0]
	}
	e.capture = s
	e.session = e.session[:0]
	e.vad.ResetAutoStop()
	e.recording = true
	e.emit.Status("recording", "Listening...", e.recordingSessionID)
	e.emitModels()
}

func (e *Engine) StopRecording() {
	if !e.recording {
		return
	}
	defer e.emitModels()
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

	e.emit.Status("transcribing", "Transcribing...", e.recordingSessionID)

	filtered := noise.Process(samples)
	size, _ := models.FromStr(e.cfg.Model)
	codes := size.SessionLanguages(e.cfg.Languages)
	e.transcribeLanguages = codes
	e.transcribeModel = e.cfg.Model
	e.transcribePost = e.post
	var prompt string
	if len(e.cfg.CustomVocabulary) > 0 {
		prompt = strings.Join(config.VocabularyHints(e.cfg.CustomVocabulary), ", ")
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

// PollTranscribe drains a pending transcription result.
func (e *Engine) PollTranscribe() {
	if !e.transcribing {
		return
	}
	select {
	case msg := <-e.transcribeCh:
		e.transcribing = false
		e.emitModels()
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
	e.emit.Transcribed(finalText, wpm, langCode, e.transcribeSamples, e.recordingSessionID)
	e.emit.Status("idle", "", e.recordingSessionID)
	if historyErr != nil {
		log.Printf("Could not save transcription history: %v", historyErr)
		e.operationError("Transcript was not saved to History. Copy the latest transcript before closing the app.")
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
	if e.loadCh != nil {
		for {
			select {
			case msg := <-e.loadCh:
				if msg.prepared != nil {
					msg.prepared.Close()
				}
			default:
				goto drained
			}
		}
	}
drained:
	e.unload()
}

// --- whisper access (serialized by whisperMu) ---

func (e *Engine) isLoaded() bool {
	e.whisperMu.Lock()
	defer e.whisperMu.Unlock()
	return e.wctx != nil
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
