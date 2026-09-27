package vad

import (
	"math"
	"testing"
)

func BenchmarkAutoStop60Seconds(b *testing.B) {
	samples := make([]float32, 60*TargetSampleRate)
	for i := range samples {
		samples[i] = float32(math.Sin(float64(i)*.2)) * .1
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		d := NewDetector(DefaultRMSThreshold)
		for end := 4800; end <= len(samples); end += 4800 {
			d.ShouldAutoStop(samples[:end], .9)
		}
	}
}

func TestIncrementalAutoStopMatchesFullAnalysis(t *testing.T) {
	d := NewDetector(DefaultRMSThreshold)
	samples := make([]float32, 5*TargetSampleRate+127)
	for i := range samples {
		if (i/FrameSize)%19 < 9 {
			samples[i] = float32(math.Sin(float64(i)*.2)) * .1
		}
	}
	for _, step := range []int{1, 127, 512, 4800, 7001} {
		d.ResetAutoStop()
		limit := len(samples)
		if step == 1 {
			limit = 5*FrameSize + 127
		}
		for end := step; end <= limit; end += step {
			for _, threshold := range []float64{0, .1, .9, 1.5} {
				result := d.AnalyzeBuffer(samples[:end])
				want := result.HasSpeechStarted && result.SilenceDurationSeconds >= threshold
				if got := d.ShouldAutoStop(samples[:end], threshold); got != want {
					t.Fatalf("step=%d end=%d threshold=%v: got %v want %v", step, end, threshold, got, want)
				}
			}
		}
	}
	// New recording must not inherit the earlier speech confirmation.
	d.ResetAutoStop()
	if d.ShouldAutoStop(make([]float32, len(samples)), .1) {
		t.Fatal("previous recording leaked")
	}
	// A threshold change or shorter buffer must also invalidate accumulated frames.
	d.RMSThreshold = .5
	if d.ShouldAutoStop(samples, .1) {
		t.Fatal("old threshold cached")
	}
	d.RMSThreshold = DefaultRMSThreshold
	if d.ShouldAutoStop(make([]float32, 2*FrameSize), .1) {
		t.Fatal("shorter recording leaked")
	}
}
