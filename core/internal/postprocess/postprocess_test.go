package postprocess

import (
	"testing"
)

func TestEmptyInput(t *testing.T) {
	p := New(true, true)
	if p.Process("") != "" {
		t.Fatal("empty input should stay empty")
	}
}

func TestRemovesFillerWords(t *testing.T) {
	p := New(true, false)
	if got := p.Process("um hello actually"); got != "hello" {
		t.Fatalf("filler removal wrong: %q", got)
	}
	if got := p.Process("เอ่อ สวัสดีครับ แบบว่า"); got != "สวัสดีครับ" {
		t.Fatalf("thai filler removal wrong: %q", got)
	}
}

func TestCapitalizesFirst(t *testing.T) {
	p := New(false, true)
	if got := p.Process("hello world"); got != "Hello world" {
		t.Fatalf("capitalize wrong: %q", got)
	}
}

func TestWordCount(t *testing.T) {
	if WordCount("hello world") != 2 {
		t.Fatal("english word count wrong")
	}
	if WordCount("") != 0 {
		t.Fatal("empty word count wrong")
	}
	if WordCount("สวัสดีครับ") < 1 {
		t.Fatal("thai word count wrong")
	}
}

func TestMixedWordCount(t *testing.T) {
	thai := "สวัสดีครับ"
	if got := WordCount(thai + " hello world"); got != WordCount(thai)+2 {
		t.Fatalf("mixed word count = %d", got)
	}
	for _, text := range []string{" ", "\n\t", "...", "! ?"} {
		if WordCount(text) != 0 {
			t.Fatalf("non-words counted in %q", text)
		}
	}
	if WordCount("don't stop") != 2 {
		t.Fatal("apostrophe split word")
	}
}
