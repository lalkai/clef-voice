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
	if got := p.Process("um hello uh"); got != "hello" {
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

func TestMixedThaiEnglishIsPreserved(t *testing.T) {
	text := "เดี๋ยวผมจะ refactor service ตัวนี้ แล้วเพิ่ม retry logic เข้าไป"
	if got := New(true, true).Process(text); got != text {
		t.Fatalf("mixed-language text changed: %q", got)
	}
}

func TestFillerRemovalPreservesMeaningfulWords(t *testing.T) {
	p := New(true, false)
	for _, input := range []string{"I like coding", "Actually, you know how this works", "อ่านหนังสือ", "อ่างล้างมือ"} {
		if got := p.Process(input); got != input {
			t.Fatalf("%q became %q", input, got)
		}
	}
	if got := p.Process("อ่า อ่า อ่านหนังสือ um uh"); got != "อ่านหนังสือ" {
		t.Fatalf("hesitations not removed safely: %q", got)
	}
}

func TestCapitalizationAfterFillerAndWhitespaceRemoval(t *testing.T) {
	if got := New(true, true).Process("  um hello world  "); got != "Hello world" {
		t.Fatal(got)
	}
}
