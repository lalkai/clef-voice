package noise

import "github.com/clefvoice/core/internal/dsp"

const targetPeak = 0.71

// Process returns a filtered copy. The intermediate stages reuse this owned
// buffer to avoid allocating four full audio buffers per transcription.
func Process(samples []float32) []float32 {
	if len(samples) <= 3 {
		return append([]float32(nil), samples...)
	}
	result := dsp.RemoveDCOffset(samples)
	floor := dsp.RMS(result) * .08
	if floor < .0005 {
		floor = .0005
	}
	for i, s := range result {
		a := s
		if a < 0 {
			a = -a
		}
		if a < floor {
			ratio := a / floor
			result[i] = s * ratio * ratio
		}
	}
	// Preserve the original left sample before overwriting each moving average.
	previous := result[0]
	for i := 1; i < len(result)-1; i++ {
		current := result[i]
		result[i] = (previous + current + result[i+1]) / 3.0
		previous = current
	}
	peak := dsp.MaxPeak(result)
	var gain float32
	switch {
	case peak <= .001:
		return result
	case peak < .3:
		gain = targetPeak / peak
		if gain > 8 {
			gain = 8
		}
	case peak >= .9:
		gain = targetPeak / peak
	default:
		return result
	}
	for i := range result {
		result[i] *= gain
	}
	return result
}
