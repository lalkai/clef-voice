package vad

import "github.com/clefvoice/core/internal/dsp"

// TargetSampleRate is the fixed sample rate of the audio pipeline.
const TargetSampleRate = 16000

const (
	// FrameSize is the analysis frame length in samples (32ms @ 16kHz).
	FrameSize = 512
	// DefaultRMSThreshold is the default energy threshold.
	DefaultRMSThreshold = 0.012
	speechConfirmFrames = 4
)

// Result is the outcome of a VAD analysis over a buffer.
type Result struct {
	IsCurrentlySpeaking    bool
	HasSpeechStarted       bool
	SilenceDurationSeconds float64
	SpeechProbability      float32
	// SpeechSampleRange is the inclusive [lo, hi) sample range containing speech.
	SpeechSampleRange [2]int
}

// Detector performs energy + zero-crossing-rate based voice activity detection.
type Detector struct {
	RMSThreshold   float32
	autoFrames     int
	autoSpeech     int
	autoStreak     int
	autoLastSpeech int
	autoSamples    int
	autoThreshold  float32
}

func NewDetector(threshold float32) *Detector {
	return &Detector{RMSThreshold: threshold}
}

// AnalyzeFrame returns (isSpeech, probability) for a single frame.
func (d *Detector) AnalyzeFrame(frame []float32) (bool, float32) {
	if len(frame) < 64 {
		return false, 0
	}
	rms := dsp.RMS(frame)
	zcr := dsp.ZeroCrossingRate(frame)

	energy := rms / d.RMSThreshold
	if energy > 1 {
		energy = 1
	}
	var zcrScore float32
	switch {
	case zcr >= 0.02 && zcr <= 0.45:
		zcrScore = 1.0
	case zcr >= 0.01 && zcr <= 0.50:
		zcrScore = 0.6
	default:
		zcrScore = 0.3
	}

	prob := energy*0.6 + zcrScore*0.4
	return prob >= 0.4 && rms >= d.RMSThreshold*0.8, prob
}

// AnalyzeBuffer analyzes the whole buffer and returns a Result.
func (d *Detector) AnalyzeBuffer(samples []float32) Result {
	frameCnt := len(samples) / FrameSize
	if frameCnt == 0 {
		return Result{}
	}

	flags := make([]bool, frameCnt)
	var probSum float32
	for i := 0; i < frameCnt; i++ {
		start := i * FrameSize
		end := start + FrameSize
		if end > len(samples) {
			end = len(samples)
		}
		isSpeech, prob := d.AnalyzeFrame(samples[start:end])
		flags[i] = isSpeech
		if isSpeech {
			probSum += prob
		}
	}

	speechCount := 0
	speechStreak := 0
	streakStart := -1
	firstSpeech := -1
	lastSpeech := -1
	for i, f := range flags {
		if f {
			speechCount++
			if speechStreak == 0 {
				streakStart = i
			}
			speechStreak++
			if speechStreak >= speechConfirmFrames {
				if firstSpeech < 0 {
					firstSpeech = streakStart
				}
				lastSpeech = i
			}
		} else {
			speechStreak = 0
		}
	}

	hasSpeech := firstSpeech >= 0
	var avgProb float32
	if speechCount > 0 {
		avgProb = probSum / float32(speechCount)
	}

	trailingWindow := 4
	if frameCnt < trailingWindow {
		trailingWindow = frameCnt
	}
	recentSpeech := 0
	for _, f := range flags[frameCnt-trailingWindow:] {
		if f {
			recentSpeech++
		}
	}
	isSpeaking := hasSpeech && recentSpeech >= 2

	var silenceSecs float64
	if lastSpeech >= 0 {
		silenceSecs = float64((frameCnt-1)-lastSpeech) * float64(FrameSize) / float64(TargetSampleRate)
	} else {
		silenceSecs = float64(len(samples)) / float64(TargetSampleRate)
	}

	var rng [2]int
	if firstSpeech >= 0 && lastSpeech >= 0 {
		const lead = 8
		const tail = 14
		// Keep quiet final words that follow confirmed speech.
		quietThreshold := d.RMSThreshold * 0.35
		if quietThreshold > 0.004 {
			quietThreshold = 0.004
		}
		if quietThreshold < 0.001 {
			quietThreshold = 0.001
		}
		lastAudible := lastSpeech
		for i := lastSpeech + 1; i < frameCnt && i-lastAudible <= 36; i++ {
			start := i * FrameSize
			if dsp.RMS(samples[start:start+FrameSize]) >= quietThreshold {
				lastAudible = i
			}
		}
		lo := firstSpeech - lead
		if lo < 0 {
			lo = 0
		}
		hi := (lastAudible + 1 + tail) * FrameSize
		if hi > len(samples) {
			hi = len(samples)
		}
		rng = [2]int{lo * FrameSize, hi}
	}

	return Result{
		IsCurrentlySpeaking:    isSpeaking,
		HasSpeechStarted:       hasSpeech,
		SilenceDurationSeconds: silenceSecs,
		SpeechProbability:      avgProb,
		SpeechSampleRange:      rng,
	}
}

// TrimSilence removes leading/trailing silence. Returns an empty slice if no
// speech was detected.
func (d *Detector) TrimSilence(samples []float32) []float32 {
	r := d.AnalyzeBuffer(samples)
	lo, hi := r.SpeechSampleRange[0], r.SpeechSampleRange[1]
	if r.HasSpeechStarted && hi-lo > 1600 {
		return append([]float32(nil), samples[lo:hi]...)
	}
	return nil
}

// ResetAutoStop starts a new recording's incremental silence detector.
func (d *Detector) ResetAutoStop() {
	d.autoFrames = 0
	d.autoSpeech = 0
	d.autoStreak = 0
	d.autoLastSpeech = -1
	d.autoSamples = 0
	d.autoThreshold = d.RMSThreshold
}

// ShouldAutoStop analyzes only newly completed frames of an append-only recording.
// Call ResetAutoStop when starting a different recording, even if its length grows.
func (d *Detector) ShouldAutoStop(samples []float32, silenceThresholdSeconds float64) bool {
	if len(samples) < d.autoSamples || d.autoThreshold != d.RMSThreshold {
		d.ResetAutoStop()
	}
	frames := len(samples) / FrameSize
	for i := d.autoFrames; i < frames; i++ {
		speech, _ := d.AnalyzeFrame(samples[i*FrameSize : (i+1)*FrameSize])
		if speech {
			d.autoStreak++
			if d.autoStreak >= speechConfirmFrames {
				d.autoSpeech = speechConfirmFrames
				d.autoLastSpeech = i
			}
		} else {
			d.autoStreak = 0
		}
	}
	d.autoFrames = frames
	d.autoSamples = len(samples)
	silence := float64(frames-1-d.autoLastSpeech) * FrameSize / TargetSampleRate
	return d.autoSpeech >= speechConfirmFrames && silence >= silenceThresholdSeconds
}
