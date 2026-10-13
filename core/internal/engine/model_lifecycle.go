package engine

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/url"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/clefvoice/core/internal/appconfig"
	"github.com/clefvoice/core/internal/config"
	"github.com/clefvoice/core/internal/models"
	"github.com/clefvoice/core/internal/protocol"
	"github.com/clefvoice/core/internal/whisper"
)

type modelItem struct {
	Group         string   `json:"group"`
	Languages     []string `json:"languages"`
	LanguageLabel string   `json:"languageLabel"`
	Quantization  string   `json:"quantization"`
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	SizeLabel     string   `json:"sizeLabel"`
	Status        string   `json:"status"`
	Downloaded    bool     `json:"downloaded"`
	Present       bool     `json:"present"`
	Active        bool     `json:"active"`
	Progress      float64  `json:"progress"`
	Received      int64    `json:"receivedBytes"`
	Total         int64    `json:"totalBytes"`
	Error         string   `json:"error,omitempty"`
}

func (e *Engine) ensureModelItems() {
	if e.modelItems != nil {
		return
	}
	e.modelItems = make([]modelItem, 0, len(models.All))
	for _, size := range models.All {
		e.modelItems = append(e.modelItems, newModelItem(size, "checking"))
	}
}

func (e *Engine) modelItem(id string) *modelItem {
	e.ensureModelItems()
	for i := range e.modelItems {
		if e.modelItems[i].ID == id {
			return &e.modelItems[i]
		}
	}
	return nil
}

func (e *Engine) emitModels() {
	e.ensureModelItems()
	for i := range e.modelItems {
		item := &e.modelItems[i]
		size, ok := models.FromStr(item.ID)
		item.Active = ok && e.models != nil && e.currentModel == e.models.LocalPath(size)
	}
	e.emit.Models(map[string]any{"items": e.modelItems, "busy": e.loading || e.recording || e.transcribing, "cancelable": e.loading && (e.modelOperation == "download" || e.modelOperation == "load" && strings.HasPrefix(e.loadMessage, "Verifying")), "operationModel": e.loadingModel})
}

func (e *Engine) Startup() { e.beginModelOperation("startup", e.cfg.Model) }

func (e *Engine) loadModel(model string) { e.beginModelOperation("load", model) }

func (e *Engine) beginModelOperation(operation, model string) {
	if operation != "startup" {
		if _, ok := models.FromStr(model); !ok {
			e.emit.Error("Unknown Whisper model.")
			return
		}
	}
	if e.loading || e.recording || e.transcribing {
		e.Handle(protocol.Command{Cmd: protocol.CmdGetState})
		e.emitModels()
		return
	}
	size, valid := models.FromStr(model)
	if operation == "load" && valid && e.models != nil && e.isLoaded() && e.currentModel == e.models.LocalPath(size) {
		e.emitModels()
		return
	}
	e.modelOperation = operation
	e.loading, e.loadingModel = true, model
	e.loadStatus, e.loadMessage, e.loadProgress, e.loadError = "loading", "Checking Whisper models...", 0, ""
	if operation != "startup" {
		e.loadMessage = fmt.Sprintf("Verifying %s model...", size.Name)
	}
	e.emit.Status(e.loadStatus, e.loadMessage)
	if item := e.modelItem(model); item != nil {
		item.Status, item.Error, item.Progress, item.Received, item.Total = "checking", "", 0, 0, -1
	}
	e.emitModels()
	ctx, cancel := context.WithCancel(context.Background())
	e.loadCancel = cancel
	ch := make(chan loadMsg, 64)
	e.loadCh = ch
	manager, useGPU, configured := e.models, e.cfg.UseGPU, e.cfg.Model
	prepare := e.prepareModel
	if prepare == nil {
		prepare = whisper.NewEngine
	}
	e.loadWG.Add(1)
	go func() {
		defer e.loadWG.Done()
		send := func(msg loadMsg) bool {
			select {
			case ch <- msg:
				return true
			case <-ctx.Done():
				return false
			}
		}
		defer func() {
			if ctx.Err() != nil {
				terminal := loadMsg{done: true, model: model, operation: "cancel", err: ctx.Err()}
				for {
					select {
					case ch <- terminal:
						return
					case discarded := <-ch:
						if discarded.prepared != nil {
							discarded.prepared.Close()
						}
					}
				}
			}
		}()
		phase := "verification"
		fail := func(err error) { send(loadMsg{done: true, model: model, operation: phase, err: err}) }
		defer func() {
			if p := recover(); p != nil {
				fail(fmt.Errorf("model operation panic: %v", p))
			}
		}()
		if manager == nil {
			fail(fmt.Errorf("model manager unavailable"))
			return
		}
		if operation == "startup" {
			scanStarted := time.Now()
			items := make([]modelItem, 0, len(models.All))
			for _, candidate := range models.All {
				item := newModelItem(candidate, "not_downloaded")
				if info, err := os.Lstat(manager.LocalPath(candidate)); err == nil {
					item.Present = true
					if info.Mode().IsRegular() {
						item.Status = "unverified"
					} else {
						item.Status = "failed"
						item.Error = "Model path is not a regular file."
					}
				}
				items = append(items, item)
			}
			log.Printf("clefd: startup presence scan: %s", time.Since(scanStarted))
			chosen := ""
			candidates := append([]string{configured, appconfig.DefaultModel}, modelIDs(items)...)
			checked := map[string]bool{}
			for _, id := range candidates {
				if checked[id] {
					continue
				}
				checked[id] = true
				candidate, ok := models.FromStr(id)
				if !ok {
					continue
				}
				for i := range items {
					if items[i].ID != id || !items[i].Present {
						continue
					}
					started := time.Now()
					err := manager.Verify(ctx, candidate)
					log.Printf("clefd: startup verification %s: %s", id, time.Since(started))
					if ctx.Err() != nil {
						return
					}
					if err == nil {
						items[i].Status = "downloaded"
						items[i].Downloaded = true
						chosen = id
					} else {
						items[i].Status = "failed"
						items[i].Error = modelError("verification", err)
					}
				}
				if chosen != "" {
					break
				}
			}
			if chosen == "" {
				send(loadMsg{items: items, done: true, operation: "scan"})
				return
			}
			model = chosen
			size, _ = models.FromStr(model)
			if !send(loadMsg{items: items, model: model}) {
				return
			}
		}
		path := manager.LocalPath(size)
		if operation == "download" {
			phase = "download"
			var last time.Time
			var err error
			path, err = manager.DownloadWithProgress(ctx, size, func(p models.Progress) {
				if p.Fraction < 1 && time.Since(last) < 100*time.Millisecond {
					return
				}
				last = time.Now()
				select {
				case ch <- loadMsg{model: model, status: "downloading", progress: p.Fraction, received: p.Received, total: p.Total}:
				default:
				}
			})
			if err != nil {
				fail(err)
				return
			}
			if operation == "download" {
				send(loadMsg{done: true, model: model, operation: "download"})
				return
			}
		} else if operation != "startup" {
			if err := manager.Verify(ctx, size); err != nil {
				fail(err)
				return
			}
		}
		if ctx.Err() != nil {
			return
		}
		phase = "initialization"
		initializedAt := time.Now()
		if !send(loadMsg{model: model, status: "loading", message: fmt.Sprintf("Initializing %s model...", size.Name)}) {
			return
		}
		prepared, err := prepare(path, useGPU)
		if err != nil && useGPU && ctx.Err() == nil {
			log.Printf("clefd: GPU load failed (%v); retrying on CPU", err)
			prepared, err = prepare(path, false)
		}
		log.Printf("clefd: model initialization %s: %s", model, time.Since(initializedAt))
		if err == nil && prepared == nil {
			err = fmt.Errorf("model initialization returned no context")
		}
		if err != nil {
			fail(err)
			return
		}
		if !send(loadMsg{done: true, model: model, prepared: prepared, operation: "load"}) && prepared != nil {
			prepared.Close()
		}
	}()
}

func modelError(phase string, err error) string {
	if errors.Is(err, context.Canceled) {
		return "Download or verification cancelled. You can retry."
	}
	if phase == "download" {
		if errors.Is(err, io.ErrUnexpectedEOF) {
			return "The connection ended before the model finished downloading. Please retry."
		}
		var network net.Error
		if errors.As(err, &network) && network.Timeout() {
			return "Model download timed out. Check your connection, then retry."
		}

		var response *models.HTTPError
		if errors.As(err, &response) {
			switch response.StatusCode {
			case 401, 403:
				return fmt.Sprintf("Model server denied the download (HTTP %d). Check network or proxy restrictions, then retry.", response.StatusCode)
			case 404:
				return "Model file was not found on the server (HTTP 404). Report this model's download URL."
			case 429:
				return "Model server is rate limiting downloads (HTTP 429). Wait a moment, then retry."
			default:
				return fmt.Sprintf("Model server returned HTTP %d. Please retry later.", response.StatusCode)
			}
		}
		var request *url.Error
		if errors.As(err, &request) {
			if request.Timeout() {
				return "Model download timed out. Check your connection, then retry."
			}
			var authority x509.UnknownAuthorityError
			var certificate x509.CertificateInvalidError
			var hostname x509.HostnameError
			if errors.As(err, &authority) || errors.As(err, &certificate) || errors.As(err, &hostname) {
				return "Could not verify the model server's TLS certificate. Check your Mac's clock and network/proxy configuration."
			}
			var dns *net.DNSError
			if errors.As(err, &dns) {
				return "Could not resolve the model server. Check your DNS or network connection, then retry."
			}
			if errors.Is(err, syscall.EPERM) || errors.Is(err, syscall.EACCES) {
				return "Network access was denied. Check firewall or proxy rules for ClefVoice and its engine, then retry."
			}
			return "Could not connect to the model server. Check your connection, proxy or firewall, then retry."
		}
	}
	if os.IsPermission(err) {
		return "Could not access the model folder. Check its permissions and retry."
	}
	if phase == "verification" {
		if os.IsNotExist(err) {
			return "Model file is missing. Download this model first."
		}
		return "Cached model could not be verified. Download it again."
	}
	if phase == "initialization" {
		return "Could not initialize the model. Try another model or download it again."
	}
	if strings.Contains(err.Error(), "checksum") || strings.Contains(err.Error(), "incomplete") {
		return "The downloaded model failed verification. Please retry the download."
	}
	if strings.Contains(err.Error(), "no space") {
		return "Not enough disk space to save the model. Free some space and retry."
	}
	return "Could not download the model. Check your connection and available disk space, then retry."
}

func (e *Engine) PollLoad() {
	if !e.loading {
		return
	}
	for {
		var msg loadMsg
		select {
		case msg = <-e.loadCh:
		default:
			return
		}
		if msg.items != nil {
			e.modelItems = msg.items
		}
		if msg.model != "" {
			e.loadingModel = msg.model
		}
		model := e.loadingModel
		item := e.modelItem(model)
		if msg.done {
			requestID := e.modelRequestID
			e.modelRequestID, e.modelOperation = "", ""
			e.loading = false
			if e.loadCancel != nil {
				e.loadCancel()
			}
			e.loadCancel, e.loadCh = nil, nil
			e.loadingModel = ""
			if msg.err == nil && msg.operation == "load" {
				cfg := e.cfg
				cfg.Model = model
				if cfg.Model != e.cfg.Model {
					msg.err = config.Save(cfg)
					if msg.err != nil {
						msg.operation = "save"
					}
				}
				if msg.err == nil {
					e.whisperMu.Lock()
					if e.wctx != nil {
						e.wctx.Close()
					}
					e.wctx, e.currentModel = msg.prepared, e.models.LocalPath(mustModel(model))
					e.whisperMu.Unlock()
					e.cfg = cfg
					e.emit.Config(e.cfg)
					e.emit.ModelLoaded(model)
				}
			}
			if msg.err != nil {
				e.emit.Config(e.cfg)
				if msg.prepared != nil {
					msg.prepared.Close()
				}
				log.Printf("clefd: %s %s failed: %v", msg.operation, model, msg.err)
				message := modelError(msg.operation, msg.err)
				if msg.operation == "cancel" {
					message = "Download cancelled. You can retry."
				}
				if msg.operation == "save" {
					message = "Could not save model choice. Check your settings folder permissions."
				}
				if item != nil {
					item.Status, item.Error = "failed", message
					if e.models != nil {
						_, err := os.Lstat(e.models.LocalPath(mustModel(model)))
						item.Present = err == nil
					}
					if msg.operation == "verification" {
						item.Downloaded = false
					}
				}
				if !e.isLoaded() && msg.operation != "cancel" {
					e.loadError = message
					e.emit.Error(message)
				} else {
					e.Handle(protocol.Command{Cmd: protocol.CmdGetState})
				}
			} else {
				if item != nil && msg.operation != "scan" {
					item.Status, item.Downloaded, item.Present, item.Progress, item.Error = "downloaded", true, true, 1, ""
				}
				if msg.operation != "scan" {
					e.emit.ModelProgress(model, 1, false)
				}
				if e.isLoaded() {
					e.emit.Status("idle", fmt.Sprintf("Model '%s' ready.", e.cfg.Model))
				} else {
					e.emit.Status("idle", "Select a downloaded model to start dictating.")
				}
			}
			if msg.err != nil {
				e.emit.Result(requestID, "failed", modelError(msg.operation, msg.err))
			} else {
				e.emit.Result(requestID, "completed", "")
			}
			e.emitModels()
			return
		}
		if msg.status != "" {
			e.loadStatus = msg.status
			if msg.status == "downloading" {
				e.loadMessage = fmt.Sprintf("Downloading %s model...", model)
				e.loadProgress = msg.progress
				if item != nil {
					item.Status, item.Progress, item.Received, item.Total = "downloading", msg.progress, msg.received, msg.total
				}
			} else {
				e.loadMessage = msg.message
				if item != nil {
					item.Status, item.Downloaded, item.Present = "loading", true, true
				}
			}
			e.emit.Status(e.loadStatus, e.loadMessage)
			e.emit.ModelProgress(model, msg.progress, msg.status == "downloading")
		}
		e.emitModels()
	}
}

func mustModel(id string) models.Size { size, _ := models.FromStr(id); return size }

func (e *Engine) deleteModel(model string) {
	size, ok := models.FromStr(model)
	if !ok {
		e.emit.Error("Unknown Whisper model.")
		return
	}
	if e.loading || e.recording || e.transcribing {
		e.emitModels()
		return
	}
	if e.models == nil {
		e.operationError("Model folder is unavailable.")
		return
	}
	item := e.modelItem(model)
	active := e.currentModel == e.models.LocalPath(size)
	if err := e.models.Delete(size); err != nil {
		e.operationError("Could not delete model. Check model folder permissions.")
		log.Printf("clefd: delete model %s: %v", model, err)
		if item != nil {
			item.Error = "Could not delete this model. Check the model folder permissions."
		}
	} else {
		if active {
			e.whisperMu.Lock()
			if e.wctx != nil {
				e.wctx.Close()
			}
			e.wctx, e.currentModel = nil, ""
			e.whisperMu.Unlock()
			e.loadError = ""
			e.emit.Status("idle", "Select a downloaded model to start dictating.")
		}
		if item != nil {
			*item = newModelItem(size, "not_downloaded")
		}
	}
	e.emitModels()
}

func newModelItem(size models.Size, status string) modelItem {
	return modelItem{ID: size.Str, Name: size.Name, SizeLabel: size.SizeLabel, Group: size.Group, Languages: append([]string{}, size.Languages...), LanguageLabel: size.LanguageLabel, Quantization: size.Quantization, Status: status, Total: -1}
}

func modelIDs(items []modelItem) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	return ids
}
