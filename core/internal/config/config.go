package config

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/clefvoice/core/internal/appconfig"
	"github.com/clefvoice/core/internal/storage"
)

// Config is the engine configuration, passed over the
// line-delimited JSON-RPC protocol by the platform shell.
type Config struct {
	Languages        []string `json:"languages"`
	Model            string   `json:"model"`
	Hotkey           string   `json:"hotkey"`
	UseGPU           bool     `json:"use_gpu"`
	VADEnabled       bool     `json:"vad_enabled"`
	VADThreshold     float32  `json:"vad_threshold"`
	AutoStopEnabled  bool     `json:"auto_stop_enabled"`
	AutoStopSeconds  float64  `json:"auto_stop_seconds"`
	RemoveFiller     bool     `json:"remove_filler_words"`
	AutoCapitalize   bool     `json:"auto_capitalize"`
	CustomVocabulary []string `json:"custom_vocabulary"`
}

// Default returns the default configuration.
func Default() Config {
	return Config{
		Languages:        []string{"th", "en"},
		Model:            appconfig.DefaultModel,
		Hotkey:           "Fn",
		UseGPU:           true,
		VADEnabled:       true,
		VADThreshold:     appconfig.DefaultVADThreshold,
		AutoStopEnabled:  false,
		AutoStopSeconds:  0.9,
		RemoveFiller:     true,
		AutoCapitalize:   true,
		CustomVocabulary: []string{"ClefVoice", "TypeScript", "TailwindCSS"},
	}
}

// Load loads configuration from ~/.clefvoice/config.json, or returns Default() if not found.
func Load() Config {
	home, err := os.UserHomeDir()
	if err != nil {
		return Default()
	}
	p := filepath.Join(home, ".clefvoice", "config.json")
	os.Chmod(filepath.Dir(p), 0700)
	os.Chmod(p, 0600)
	b, err := os.ReadFile(p)
	if err != nil {
		cfg := Default()
		_ = Save(cfg)
		return cfg
	}
	cfg := Default()
	_ = json.Unmarshal(b, &cfg)
	return cfg
}

// Save writes configuration to ~/.clefvoice/config.json atomically.
func Save(cfg Config) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dir := filepath.Join(home, ".clefvoice")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	if err := os.Chmod(dir, 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "config.json")
	return storage.WritePrivateFile(path, b)
}
