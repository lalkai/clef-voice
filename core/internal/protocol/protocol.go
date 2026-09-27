package protocol

import (
	"bufio"
	"encoding/json"
	"io"
)

// Command is a line-delimited JSON-RPC request received on stdin.
type Command struct {
	Cmd    string          `json:"cmd"`
	Config json.RawMessage `json:"config"`
	Model  string          `json:"model"`
	ID     string          `json:"id"`
}

// Command names.
const (
	CmdPing          = "ping"
	CmdGetState      = "get_state"
	CmdSetConfig     = "set_config"
	CmdLoadModel     = "load_model"
	CmdStart         = "start"
	CmdStop          = "stop"
	CmdToggle        = "toggle"
	CmdShutdown      = "shutdown"
	CmdGetHistory    = "get_history"
	CmdClearHistory  = "clear_history"
	CmdDeleteHistory = "delete_history"
	CmdGetStats      = "get_stats"
	CmdGetConfig     = "get_config"
)

// Emitter serializes events to stdout as newline-delimited JSON.
type Emitter struct {
	w *bufio.Writer
}

func NewEmitter(w io.Writer) *Emitter {
	return &Emitter{w: bufio.NewWriter(w)}
}

func (e *Emitter) emit(v any) {
	if b, err := json.Marshal(v); err == nil {
		e.w.Write(b)
		e.w.WriteByte('\n')
		e.w.Flush()
	}
}

func (e *Emitter) Ready(version string) {
	e.emit(map[string]any{"type": "ready", "version": version})
}

func (e *Emitter) Status(status, message string) {
	e.emit(map[string]any{"type": "status", "status": status, "message": message})
}

func (e *Emitter) Level(level float32) {
	e.emit(map[string]any{"type": "level", "level": level})
}

func (e *Emitter) Transcribed(text string, wpm float64, language string, samples int) {
	e.emit(map[string]any{
		"type": "transcribed", "text": text, "wpm": wpm,
		"language": language, "samples": samples,
	})
}

func (e *Emitter) ModelProgress(model string, progress float64, downloading bool) {
	e.emit(map[string]any{
		"type": "model_progress", "model": model,
		"progress": progress, "downloading": downloading,
	})
}

func (e *Emitter) ModelLoaded(model string) {
	e.emit(map[string]any{"type": "model_loaded", "model": model})
}

func (e *Emitter) History(items any) {
	e.emit(map[string]any{"type": "history", "items": items})
}

func (e *Emitter) Stats(stats any) {
	e.emit(map[string]any{"type": "stats", "stats": stats})
}

func (e *Emitter) Config(cfg any) {
	e.emit(map[string]any{"type": "config", "config": cfg})
}

func (e *Emitter) Error(message string) {
	e.emit(map[string]any{"type": "error", "message": message})
}
