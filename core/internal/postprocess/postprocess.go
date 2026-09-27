package postprocess

import (
	"regexp"
	"strings"
	"unicode"
)

var fillerWords = []string{
	"เอ่อ", "อ่า", "อือ", "อืม", "แบบว่า", "คือว่า",
	"um", "uh", "hmm", "like", "you know", "actually",
}

// Processor applies filler-word removal, capitalization and whitespace
// collapsing to raw transcription text.
type Processor struct {
	removeFiller bool
	autoCaps     bool
	fillers      []*regexp.Regexp
}

func New(removeFiller, autoCaps bool) *Processor {
	p := &Processor{removeFiller: removeFiller, autoCaps: autoCaps}
	p.fillers = buildFillerRegexes()
	return p
}

func (p *Processor) Process(text string) string {
	if text == "" {
		return ""
	}

	result := text
	if p.removeFiller {
		for _, re := range p.fillers {
			result = re.ReplaceAllString(result, "")
		}
	}
	if p.autoCaps && result != "" {
		result = capitalizeFirst(result)
	}

	ws := regexp.MustCompile(`\s+`)
	result = ws.ReplaceAllString(result, " ")
	return strings.TrimSpace(result)
}

func buildFillerRegexes() []*regexp.Regexp {
	var out []*regexp.Regexp
	for _, w := range fillerWords {
		pattern := regexp.QuoteMeta(w)
		if isASCII(w) {
			pattern = `\b` + pattern + `\b`
		}
		if re, err := regexp.Compile("(?i)" + pattern); err == nil {
			out = append(out, re)
		}
	}
	return out
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 {
			return false
		}
	}
	return true
}

func capitalizeFirst(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	return strings.ToUpper(string(r[0])) + string(r[1:])
}

// WordCount counts non-Thai tokens and estimates Thai words as ceil(letters
// and marks / 2.5). Thai remains an approximation, not dictionary segmentation.
func WordCount(text string) int {
	thaiChars, words := 0, 0
	inWord := false
	for _, c := range text {
		if unicode.In(c, unicode.Thai) && (unicode.IsLetter(c) || unicode.IsMark(c)) {
			thaiChars++
			inWord = false
		} else if unicode.IsLetter(c) || unicode.IsNumber(c) {
			if !inWord {
				words++
			}
			inWord = true
		} else if c != '\'' && c != '’' && !unicode.IsMark(c) {
			inWord = false
		}
	}
	return words + (thaiChars*2+4)/5
}
