package noise

import (
	"github.com/clefvoice/core/internal/dsp"
	"math"
	"math/rand"
	"reflect"
	"testing"
)

var benchmarkOutput []float32

func BenchmarkProcess30Seconds(b *testing.B) {
	samples := make([]float32, 30*16000)
	for i := range samples {
		samples[i] = float32(math.Sin(float64(i)*.04))*.2 + .01
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		benchmarkOutput = Process(samples)
	}
}

// referenceProcess applies DC removal, a noise gate, a 3-point moving-average low-pass,
// and peak normalization.
func referenceProcess(samples []float32) []float32 {
	if len(samples) <= 3 {
		return append([]float32(nil), samples...)
	}
	result := dsp.RemoveDCOffset(samples)
	result = referenceapplyNoiseGate(result)
	result = referenceapplyLowPass(result)
	result = referencenormalizeGain(result)
	return result
}

func referenceapplyNoiseGate(samples []float32) []float32 {
	rms := dsp.RMS(samples)
	floor := rms * 0.08
	if floor < 0.0005 {
		floor = 0.0005
	}
	out := make([]float32, len(samples))
	for i, s := range samples {
		a := s
		if a < 0 {
			a = -a
		}
		if a < floor {
			ratio := a / floor
			out[i] = s * ratio * ratio
		} else {
			out[i] = s
		}
	}
	return out
}

func referenceapplyLowPass(samples []float32) []float32 {
	n := len(samples)
	if n < 3 {
		return append([]float32(nil), samples...)
	}
	out := make([]float32, n)
	out[0] = samples[0]
	for i := 1; i < n-1; i++ {
		out[i] = (samples[i-1] + samples[i] + samples[i+1]) / 3.0
	}
	out[n-1] = samples[n-1]
	return out
}

func referencenormalizeGain(samples []float32) []float32 {
	peak := dsp.MaxPeak(samples)
	switch {
	case peak <= 0.001:
		return append([]float32(nil), samples...)
	case peak < 0.3:
		gain := targetPeak / peak
		if gain > 8.0 {
			gain = 8.0
		}
		out := make([]float32, len(samples))
		for i, s := range samples {
			out[i] = s * gain
		}
		return out
	case peak >= 0.9:
		attn := targetPeak / peak
		out := make([]float32, len(samples))
		for i, s := range samples {
			out[i] = s * attn
		}
		return out
	default:
		return append([]float32(nil), samples...)
	}
}

func TestProcessMatchesOriginalAndPreservesInput(t *testing.T) {
	random := rand.New(rand.NewSource(42))
	for _, length := range []int{0, 1, 2, 3, 4, 511, 16000} {
		for _, gain := range []float32{0, .0001, .01, .3, 1, 2} {
			input := make([]float32, length)
			for i := range input {
				input[i] = (random.Float32()*2 - 1) * gain
			}
			original := append([]float32{}, input...)
			got, want := Process(input), referenceProcess(input)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("output changed: length=%d gain=%v", length, gain)
			}
			if !reflect.DeepEqual(input, original) {
				t.Fatal("input was modified")
			}
			if len(got) > 0 {
				got[0] = 123
				if !reflect.DeepEqual(input, original) {
					t.Fatal("output aliases input")
				}
			}
		}
	}
}
