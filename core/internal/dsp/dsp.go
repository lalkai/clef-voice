package dsp

import "math"

// RMS returns the root mean square of the samples.
func RMS(samples []float32) float32 {
	if len(samples) == 0 {
		return 0
	}
	var sum float64
	for _, s := range samples {
		sum += float64(s) * float64(s)
	}
	return float32(math.Sqrt(sum / float64(len(samples))))
}

// MaxPeak returns the maximum absolute sample value.
func MaxPeak(samples []float32) float32 {
	var acc float32
	for _, s := range samples {
		a := float32(math.Abs(float64(s)))
		if a > acc {
			acc = a
		}
	}
	return acc
}

// Mean returns the arithmetic mean of the samples.
func Mean(samples []float32) float32 {
	if len(samples) == 0 {
		return 0
	}
	var sum float64
	for _, s := range samples {
		sum += float64(s)
	}
	return float32(sum / float64(len(samples)))
}

// RemoveDCOffset subtracts the DC offset (mean) from the samples.
func RemoveDCOffset(samples []float32) []float32 {
	m := Mean(samples)
	if math.Abs(float64(m)) <= 0.0001 {
		return append([]float32(nil), samples...)
	}
	out := make([]float32, len(samples))
	for i, s := range samples {
		out[i] = s - m
	}
	return out
}

// ZeroCrossingRate returns crossings per sample.
func ZeroCrossingRate(samples []float32) float32 {
	if len(samples) <= 1 {
		return 0
	}
	crossings := 0
	for i := 1; i < len(samples); i++ {
		if (samples[i] >= 0 && samples[i-1] < 0) || (samples[i] < 0 && samples[i-1] >= 0) {
			crossings++
		}
	}
	return float32(crossings) / float32(len(samples))
}
