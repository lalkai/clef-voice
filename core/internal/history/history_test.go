package history

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestHistoryAndActivitySurviveReload(t *testing.T) {
	s := &Store{path: filepath.Join(t.TempDir(), "history.json")}
	s.Add("hello world", "en", 120)
	before := s.GetStats()
	reloaded := &Store{path: s.path}
	reloaded.load()
	if got := reloaded.GetStats(); !reflect.DeepEqual(got, before) {
		t.Fatalf("stats changed after reload: got %+v, want %+v", got, before)
	}
	if !reloaded.items[0].Timestamp.Equal(s.items[0].Timestamp) {
		t.Fatal("creation time was not preserved")
	}
	reloaded.Delete(s.items[0].ID)
	reloaded.load()
	if len(reloaded.GetHistory()) != 0 || reloaded.GetStats().TotalWords != 0 {
		t.Fatal("deleted item survived reload")
	}
}

func TestNewStoreRestrictsExistingHistoryPermissions(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	dir := filepath.Join(os.Getenv("HOME"), ".clefvoice")
	if err := os.Mkdir(dir, 0755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "history.json")
	if err := os.WriteFile(path, []byte(`[]`), 0644); err != nil {
		t.Fatal(err)
	}
	s := NewStore()
	s.Add("private dictation", "en", 100)
	for path, want := range map[string]os.FileMode{dir: 0700, s.path: 0600} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != want {
			t.Errorf("%s permissions = %04o, want %04o", path, got, want)
		}
	}
}

func TestHistoryMutationFailureKeepsMemoryUnchanged(t *testing.T) {
	s := &Store{path: filepath.Join(t.TempDir(), "missing", "history.json")}
	if err := s.Add("hello", "en", 120); err == nil {
		t.Fatal("adding history should fail when the directory is missing")
	}
	if len(s.GetHistory()) != 0 {
		t.Fatal("failed add appeared in history")
	}
	s.items = []Item{{ID: "existing", Text: "keep this"}}
	if err := s.Clear(); err == nil {
		t.Fatal("clearing history should fail when the directory is missing")
	}
	if err := s.Delete("existing"); err == nil {
		t.Fatal("deleting history should fail when the directory is missing")
	}
	if items := s.GetHistory(); len(items) != 1 || items[0].Text != "keep this" {
		t.Fatalf("failed mutation changed history: %+v", items)
	}
}

func TestInvalidHistoryIsNotOverwritten(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.json")
	invalid := []byte(`[{"text":`)
	if err := os.WriteFile(path, invalid, 0600); err != nil {
		t.Fatal(err)
	}
	s := &Store{path: path}
	s.load()
	if err := s.Add("new dictation", "en", 120); err == nil {
		t.Fatal("new dictation overwrote invalid history")
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(invalid) || len(s.GetHistory()) != 0 {
		t.Fatalf("invalid history was changed: file=%q, items=%+v", got, s.GetHistory())
	}
}

func TestLegacyHistoryRemainsReadable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.json")
	if err := os.WriteFile(path, []byte(`[{"id":"old","timestamp":"10:42 AM","text":"hello","wordCount":1,"wpm":120}]`), 0600); err != nil {
		t.Fatal(err)
	}
	s := &Store{path: path}
	s.load()
	if len(s.GetHistory()) != 1 || s.GetStats().TotalWords != 1 {
		t.Fatal("legacy history was lost")
	}
	if len(s.GetStats().ActiveDays) != 0 {
		t.Fatal("legacy entries without dates must not invent activity")
	}
}

func TestMeasuredHistoryAndFavoritesSurviveReload(t *testing.T) {
	s := &Store{path: filepath.Join(t.TempDir(), "history.json")}
	if err := s.AddResult("สวัสดี React", "th,en", 120, 4, 2, .75, "base"); err != nil {
		t.Fatal(err)
	}
	id := s.GetHistory()[0].ID
	if err := s.SetFavorite(id, true); err != nil {
		t.Fatal(err)
	}
	reloaded := &Store{path: s.path}
	reloaded.load()
	item := reloaded.GetHistory()[0]
	if !item.Favorite || item.Model != "base" || item.ProcessingSeconds == nil || *item.ProcessingSeconds != .75 {
		t.Fatalf("metadata lost after reload: %+v", item)
	}
	if err := reloaded.SetFavorite(id, false); err != nil {
		t.Fatal(err)
	}
	if reloaded.GetHistory()[0].Favorite {
		t.Fatal("favorite was not removed")
	}
	if err := reloaded.SetFavorite("missing", true); err == nil {
		t.Fatal("missing item silently accepted")
	}
}

func TestFavoriteSaveFailureKeepsPreviousValue(t *testing.T) {
	s := &Store{path: filepath.Join(t.TempDir(), "missing", "history.json"), items: []Item{{ID: "keep"}}}
	if err := s.SetFavorite("keep", true); err == nil {
		t.Fatal("expected save failure")
	}
	if s.GetHistory()[0].Favorite {
		t.Fatal("failed favorite update changed memory")
	}
}

func TestProcessingAverageExcludesLegacyHistory(t *testing.T) {
	a, b := 1.0, 3.0
	s := &Store{items: []Item{{Text: "legacy"}, {ProcessingSeconds: &a}, {ProcessingSeconds: &b}}}
	got := s.GetStats().AverageProcessingSeconds
	if got == nil || *got != 2 {
		t.Fatalf("average = %v, want 2", got)
	}
	s.items = []Item{{Text: "legacy"}}
	if s.GetStats().AverageProcessingSeconds != nil {
		t.Fatal("legacy history invented zero latency")
	}
}

func TestActivityExcludesOldAndFutureEntries(t *testing.T) {
	now := time.Now()
	s := &Store{items: []Item{
		{Timestamp: now.Add(-8 * 24 * time.Hour)},
		{Timestamp: now.Add(24 * time.Hour)},
		{},
	}}
	if got := s.GetStats().ActiveDays; len(got) != 0 {
		t.Fatalf("unexpected activity: %v", got)
	}
}

func TestStatsUseTotalWordsOverTotalDuration(t *testing.T) {
	wordsA, wordsB := 10, 90
	s := &Store{items: []Item{
		{WordCount: 10, SpokenWords: &wordsA, DurationSeconds: 5, WPM: 120},
		{WordCount: 90, SpokenWords: &wordsB, DurationSeconds: 90, WPM: 60},
	}}
	// 100 words / 95 seconds * 60 = 63, not the arithmetic mean 90.
	if got := s.GetStats().SpeechWPM; got != 63 {
		t.Fatalf("weighted WPM = %d", got)
	}
}

func TestEmptyStatsDoNotInventSpeed(t *testing.T) {
	if got := (&Store{}).GetStats(); got.SpeechWPM != 0 || got.MinutesSaved != 0 {
		t.Fatalf("empty stats: %+v", got)
	}
}

func TestExpandedTextDoesNotInflateSpeechSpeed(t *testing.T) {
	s := &Store{path: filepath.Join(t.TempDir(), "history.json")}
	s.AddMeasured("one two three four five six", "en", 30, 1, 2)
	s.load()
	if got := s.GetStats(); got.SpeechWPM != 30 || got.TotalWords != 6 || got.MinutesSaved < 0 {
		t.Fatalf("stats: %+v", got)
	}
}

func TestLegacyWPMUsesInferredDuration(t *testing.T) {
	s := &Store{items: []Item{{WordCount: 10, WPM: 120}, {WordCount: 90, WPM: 60}}}
	if got := s.GetStats().SpeechWPM; got != 63 {
		t.Fatalf("legacy WPM = %d", got)
	}
}
