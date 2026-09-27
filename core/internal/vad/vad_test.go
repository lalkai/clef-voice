package vad

import (
	"math"
	"testing"
)

func sine(freq float32, n int) []float32 {
	out := make([]float32, n)
	for i := range out {
		out[i] = float32(math.Sin(2*math.Pi*float64(freq)*float64(i)/TargetSampleRate)) * 0.5
	}
	return out
}

func TestSilenceIsNotSpeech(t *testing.T) {
	d := NewDetector(DefaultRMSThreshold)
	if speech, _ := d.AnalyzeFrame(make([]float32, FrameSize)); speech {
		t.Fatal("silence should not be speech")
	}
}

func TestLoudToneIsSpeech(t *testing.T) {
	d := NewDetector(DefaultRMSThreshold)
	if speech, prob := d.AnalyzeFrame(sine(440, FrameSize)); !speech || prob <= 0.5 {
		t.Fatalf("loud tone should be speech, got speech=%v prob=%v", speech, prob)
	}
}

func TestTrimSilenceEmptyOnPureSilence(t *testing.T) {
	d := NewDetector(DefaultRMSThreshold)
	if got := d.TrimSilence(make([]float32, TargetSampleRate*2)); len(got) != 0 {
		t.Fatal("pure silence should trim to empty")
	}
}

func TestTrimSilenceKeepsSpeech(t *testing.T) {
	d := NewDetector(DefaultRMSThreshold)
	samples := make([]float32, TargetSampleRate)
	samples = append(samples, sine(440, TargetSampleRate*2)...)
	samples = append(samples, make([]float32, TargetSampleRate)...)
	got := d.TrimSilence(samples)
	if len(got) == 0 || len(got) >= len(samples) {
		t.Fatalf("trim should keep speech only, got %d of %d", len(got), len(samples))
	}
}

func TestTrimSilenceKeepsQuietEnding(t *testing.T) {
	d := NewDetector(DefaultRMSThreshold)
	strong := sine(440, TargetSampleRate)
	quiet := sine(440, TargetSampleRate)
	for i := range quiet {
		quiet[i] *= 0.016
	}
	samples := append(strong, quiet...)
	samples = append(samples, make([]float32, TargetSampleRate)...)
	got := d.TrimSilence(samples)
	if len(got) < 2*TargetSampleRate || len(got) >= len(samples) {
		t.Fatalf("quiet ending was cut or silence was not trimmed: got %.2fs of %.2fs", float64(len(got))/TargetSampleRate, float64(len(samples))/TargetSampleRate)
	}
}

func TestSeparatedNoiseBurstsDoNotConfirmSpeech(t *testing.T) {
	d := NewDetector(DefaultRMSThreshold)
	samples := make([]float32, 24*FrameSize)
	burst := sine(440, 2*FrameSize)
	for _, frame := range []int{2, 9, 17} {
		copy(samples[frame*FrameSize:], burst)
	}

	if result := d.AnalyzeBuffer(samples); result.HasSpeechStarted {
		t.Fatal("isolated noise bursts were counted as speech")
	}
	if got := d.TrimSilence(samples); len(got) != 0 {
		t.Fatal("noise bursts should not reach transcription")
	}
	if d.ShouldAutoStop(samples, 0.1) {
		t.Fatal("noise bursts should not activate auto-stop")
	}
}

func TestTrimSilenceQuietEndingAfterPause(t *testing.T) {
	d := NewDetector(DefaultRMSThreshold)
	strong := sine(440, TargetSampleRate)
	pause := make([]float32, 20*FrameSize) // 640ms pause
	quiet := sine(440, TargetSampleRate/2)  // 500ms quiet speech
	for i := range quiet {
		quiet[i] *= 0.016
	}
	trailing := make([]float32, TargetSampleRate)

	samples := append(strong, pause...)
	samples = append(samples, quiet...)
	samples = append(samples, trailing...)

	res := d.AnalyzeBuffer(samples)
	minExpectedHi := len(strong) + len(pause) + len(quiet)
	if res.SpeechSampleRange[1] < minExpectedHi {
		t.Fatalf("quiet ending after pause was cut: hi=%d < expected %d", res.SpeechSampleRange[1], minExpectedHi)
	}
	got := d.TrimSilence(samples)
	if len(got) < minExpectedHi {
		t.Fatalf("TrimSilence trimmed quiet ending: got %d < expected %d", len(got), minExpectedHi)
	}
}

