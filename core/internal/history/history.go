package history

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/clefvoice/core/internal/appconfig"
	"github.com/clefvoice/core/internal/postprocess"
	"github.com/clefvoice/core/internal/storage"
	"github.com/google/uuid"
)

type Item struct {
	ID                string    `json:"id"`
	Timestamp         time.Time `json:"createdAt"`
	TimeStr           string    `json:"timestamp"`
	Text              string    `json:"text"`
	CharCount         int       `json:"charCount"`
	WordCount         int       `json:"wordCount"`
	WPM               float64   `json:"wpm"`
	Language          string    `json:"language"`
	DurationSeconds   float64   `json:"durationSeconds,omitempty"`
	SpokenWords       *int      `json:"spokenWords,omitempty"`
	ProcessingSeconds *float64  `json:"processingSeconds,omitempty"`
	Model             string    `json:"model,omitempty"`
	Favorite          bool      `json:"favorite,omitempty"`
}

type Stats struct {
	TotalWords               int      `json:"totalWords"`
	DictationCount           int      `json:"dictationCount"`
	SpeechWPM                int      `json:"speechWpm"`
	MinutesSaved             int      `json:"minutesSaved"`
	ActiveDays               []int    `json:"activeDays"`
	AverageProcessingSeconds *float64 `json:"averageProcessingSeconds,omitempty"`
}

type Store struct {
	mu      sync.RWMutex
	items   []Item
	path    string
	loadErr error
}

func NewStore() *Store {
	home, err := os.UserHomeDir()
	if err != nil {
		return &Store{}
	}
	dir := filepath.Join(home, ".clefvoice")
	os.MkdirAll(dir, 0700)
	os.Chmod(dir, 0700)

	s := &Store{
		path: filepath.Join(dir, "history.json"),
	}
	os.Chmod(s.path, 0600)
	s.load()
	return s
}

func (s *Store) load() {
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			s.loadErr = nil
		} else {
			s.loadErr = err
		}
		return
	}
	var items []Item
	if err := json.Unmarshal(b, &items); err != nil {
		s.loadErr = fmt.Errorf("invalid history JSON: %w", err)
		return
	}
	s.items = items
	s.loadErr = nil
}

func (s *Store) save() error {
	if s.loadErr != nil {
		return fmt.Errorf("history could not be loaded: %w", s.loadErr)
	}
	if s.path == "" {
		return errors.New("history path unavailable")
	}
	b, err := json.MarshalIndent(s.items, "", "  ")
	if err != nil {
		return err
	}
	return storage.WritePrivateFile(s.path, b)
}

func (s *Store) Add(text, language string, wpm float64) error {
	return s.add(text, language, wpm, nil, 0, nil, "")
}

func (s *Store) AddMeasured(text, language string, wpm float64, spokenWords int, durationSeconds float64) error {
	return s.add(text, language, wpm, &spokenWords, durationSeconds, nil, "")
}

func (s *Store) AddResult(text, language string, wpm float64, spokenWords int, durationSeconds float64, processingSeconds float64, model string) error {
	return s.add(text, language, wpm, &spokenWords, durationSeconds, &processingSeconds, model)
}

func (s *Store) add(text, language string, wpm float64, spokenWords *int, durationSeconds float64, processingSeconds *float64, model string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	item := Item{
		ID:                uuid.New().String(),
		Timestamp:         now,
		TimeStr:           now.Format("3:04 PM"),
		Text:              text,
		CharCount:         utf8.RuneCountInString(text),
		WordCount:         postprocess.WordCount(text),
		WPM:               wpm,
		Language:          language,
		SpokenWords:       spokenWords,
		DurationSeconds:   durationSeconds,
		ProcessingSeconds: processingSeconds,
		Model:             model,
	}

	previous := s.items
	s.items = append([]Item{item}, s.items...)
	if len(s.items) > 1000 {
		s.items = s.items[:1000]
	}
	if err := s.save(); err != nil {
		s.items = previous
		return err
	}
	return nil
}

func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous := s.items
	s.items = make([]Item, 0)
	if err := s.save(); err != nil {
		s.items = previous
		return err
	}
	return nil
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	filtered := make([]Item, 0, len(s.items))
	for _, item := range s.items {
		if item.ID != id {
			filtered = append(filtered, item)
		}
	}
	previous := s.items
	s.items = filtered
	if err := s.save(); err != nil {
		s.items = previous
		return err
	}
	return nil
}

func (s *Store) GetHistory() []Item {
	s.mu.RLock()
	defer s.mu.RUnlock()
	res := make([]Item, len(s.items))
	copy(res, s.items)
	return res
}

func (s *Store) SetFavorite(id string, favorite bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, item := range s.items {
		if item.ID != id {
			continue
		}
		previous := s.items
		s.items = append([]Item(nil), previous...)
		s.items[i].Favorite = favorite
		if err := s.save(); err != nil {
			s.items = previous
			return err
		}
		return nil
	}
	return errors.New("history item not found")
}

func (s *Store) GetStats() Stats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	totalWords := 0
	var spokenWords, measuredOutputWords int
	var totalSeconds float64
	var processingTotal float64
	var processingCount int

	now := time.Now()
	activeMap := make(map[int]bool)

	for _, item := range s.items {
		if seconds := item.ProcessingSeconds; seconds != nil && *seconds >= 0 && !math.IsInf(*seconds, 0) && !math.IsNaN(*seconds) {
			processingTotal += *seconds
			processingCount++
		}
		totalWords += item.WordCount
		words := item.WordCount
		if item.SpokenWords != nil {
			words = *item.SpokenWords
		}
		seconds := item.DurationSeconds
		// Older history has no duration; infer its original denominator from WPM.
		if seconds == 0 && item.WPM > 0 {
			seconds = float64(words) / item.WPM * 60
		}
		if seconds > 0 && !math.IsInf(seconds, 0) && !math.IsNaN(seconds) && words >= 0 {
			spokenWords += words
			measuredOutputWords += item.WordCount
			totalSeconds += seconds
		}

		// Active days in the last 7 days (0=Sun, ..., 6=Sat)
		if age := now.Sub(item.Timestamp); !item.Timestamp.IsZero() && age >= 0 && age < 7*24*time.Hour {
			weekday := int(item.Timestamp.Weekday())
			activeMap[weekday] = true
		}
	}

	speechWpm := 0.0
	minutesSaved := 0
	if totalSeconds > 0 {
		speechWpm = float64(spokenWords) / totalSeconds * 60
		// Output words can differ after post-processing; speed uses spoken words.
		minutesSaved = int(math.Round(math.Max(0, float64(measuredOutputWords)/appconfig.TypingWPM-totalSeconds/60)))
	}

	activeDays := make([]int, 0, len(activeMap))
	for d := range activeMap {
		activeDays = append(activeDays, d)
	}
	var averageProcessing *float64
	if processingCount > 0 {
		average := processingTotal / float64(processingCount)
		averageProcessing = &average
	}

	return Stats{
		TotalWords:               totalWords,
		DictationCount:           len(s.items),
		SpeechWPM:                int(math.Round(speechWpm)),
		MinutesSaved:             minutesSaved,
		ActiveDays:               activeDays,
		AverageProcessingSeconds: averageProcessing,
	}
}
