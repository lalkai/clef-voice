package dsp

import (
	"math"
	"testing"
)

func TestRMS(t *testing.T) {
	if r := RMS([]float32{1, 2, 3, 4}); math.Abs(float64(r-2.7386)) > 1e-3 {
		t.Fatalf("rms = %v", r)
	}
	if RMS(nil) != 0 {
		t.Fatal("empty rms should be 0")
	}
}

func TestMean(t *testing.T) {
	if m := Mean([]float32{1, 2, 3}); math.Abs(float64(m-2)) > 1e-6 {
		t.Fatalf("mean = %v", m)
	}
}

func TestZeroCrossingRate(t *testing.T) {
	z := ZeroCrossingRate([]float32{-1, 1, -1, 1})
	if math.Abs(float64(z-0.75)) > 1e-6 {
		t.Fatalf("zcr = %v", z)
	}
}

func TestRemoveDCOffset(t *testing.T) {
	out := RemoveDCOffset([]float32{1, 2, 3})
	if math.Abs(float64(out[0]+1)) > 1e-6 || math.Abs(float64(out[2]-1)) > 1e-6 {
		t.Fatalf("dc offset removal wrong: %v", out)
	}
}
