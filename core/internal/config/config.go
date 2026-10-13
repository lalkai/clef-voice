package config

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

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
		Languages:        []string{},
		Model:            appconfig.DefaultModel,
		Hotkey:           appconfig.DefaultHotkey,
		UseGPU:           true,
		VADEnabled:       appconfig.DefaultVADEnabled,
		VADThreshold:     appconfig.DefaultVADThreshold,
		AutoStopEnabled:  appconfig.DefaultAutoStopEnabled,
		AutoStopSeconds:  appconfig.DefaultAutoStopSeconds,
		RemoveFiller:     appconfig.DefaultRemoveFiller,
		AutoCapitalize:   appconfig.DefaultAutoCapitalize,
		CustomVocabulary: appconfig.DefaultVocabulary(),
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
	if err := json.Unmarshal(b, &cfg); err != nil {
		return Default()
	}
	cfg.NormalizeVocabulary()
	if err := cfg.Validate(); err != nil {
		// Keep legacy vocabulary visible for correction without resetting other preferences.
		audioOnly := cfg
		audioOnly.CustomVocabulary = nil
		if audioOnly.Validate() != nil {
			return Default()
		}
	}
	return cfg
}

// Save writes configuration to ~/.clefvoice/config.json atomically.
func Save(cfg Config) error {
	cfg.NormalizeVocabulary()
	if err := cfg.Validate(); err != nil {
		return err
	}
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

func (cfg *Config) NormalizeVocabulary() {
	seen := map[string]bool{}
	words := make([]string, 0, len(cfg.CustomVocabulary))
	for _, word := range cfg.CustomVocabulary {
		word = strings.TrimSpace(word)
		if word != "" && !seen[word] {
			words = append(words, word)
			seen[word] = true
		}
	}
	cfg.CustomVocabulary = words
}

func (cfg Config) Validate() error {
	if len(cfg.CustomVocabulary) > appconfig.VocabularyWords {
		return fmt.Errorf("custom vocabulary allows at most %d words", appconfig.VocabularyWords)
	}
	total := 0
	for _, word := range cfg.CustomVocabulary {
		length := utf8.RuneCountInString(word)
		if length > appconfig.WordCharacters {
			return fmt.Errorf("each vocabulary word allows at most %d Unicode characters", appconfig.WordCharacters)
		}
		total += length
	}
	if total > appconfig.VocabularyCharacters {
		return fmt.Errorf("vocabulary allows at most %d Unicode characters in total", appconfig.VocabularyCharacters)
	}
	threshold := float64(cfg.VADThreshold)
	if math.IsNaN(threshold) || math.IsInf(threshold, 0) || threshold <= 0 || threshold > 1 {
		return fmt.Errorf("VAD threshold must be greater than 0 and at most 1")
	}
	if math.IsNaN(cfg.AutoStopSeconds) || math.IsInf(cfg.AutoStopSeconds, 0) || cfg.AutoStopSeconds <= 0 {
		return fmt.Errorf("auto-stop pause must be greater than 0")
	}
	return nil
}

// VocabularyHints bounds legacy input without rewriting the saved vocabulary.
func VocabularyHints(words []string) []string {
	cfg := Config{CustomVocabulary: append([]string(nil), words...)}
	cfg.NormalizeVocabulary()
	hints := []string{}
	total := 0
	for _, word := range cfg.CustomVocabulary {
		count := utf8.RuneCountInString(word)
		if count > appconfig.WordCharacters || total+count > appconfig.VocabularyCharacters {
			continue
		}
		if len(hints) >= appconfig.VocabularyWords {
			break
		}
		hints = append(hints, word)
		total += count
	}
	return hints
}
