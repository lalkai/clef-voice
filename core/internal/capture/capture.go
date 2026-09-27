package capture

import (
	"math"
	"sync/atomic"
	"unsafe"

	"github.com/clefvoice/core/internal/dsp"
	"github.com/gen2brain/malgo"
)

// ChunkQueueCapacity bounds the audio channel (a few seconds of slack).
const ChunkQueueCapacity = 256

// Session holds a running capture device. Audio arrives as []float32 chunks
// of 16 kHz mono PCM on Ch.
type Session struct {
	device *malgo.Device
	ctx    *malgo.AllocatedContext

	// Ch delivers captured 16 kHz mono float32 chunks.
	Ch chan []float32

	// Smoothed audio level (0..=1) as f32 bits.
	level     atomic.Uint32
	smoothing atomic.Uint32
}

// Start opens the default input device at 16 kHz mono f32 and begins capture.
func Start() (*Session, error) {
	ctx, err := malgo.InitContext(nil, malgo.ContextConfig{}, func(string) {})
	if err != nil {
		return nil, err
	}

	cfg := malgo.DefaultDeviceConfig(malgo.Capture)
	cfg.Capture.Format = malgo.FormatF32
	cfg.Capture.Channels = 1
	cfg.SampleRate = 16000

	s := &Session{ctx: ctx, Ch: make(chan []float32, ChunkQueueCapacity)}

	callbacks := malgo.DeviceCallbacks{
		Data: func(_, input []byte, _ uint32) {
			if len(input) < 4 {
				return
			}
			// Reinterpret the interleaved f32 bytes as float32 samples.
			n := len(input) / 4
			samples := unsafe.Slice((*float32)(unsafe.Pointer(&input[0])), n)
			// Copy so the audio-thread buffer can be reused by miniaudio.
			chunk := make([]float32, n)
			copy(chunk, samples)

			s.level.Store(math.Float32bits(updateLevel(s, chunk)))

			select {
			case s.Ch <- chunk:
			default: // drop if the consumer has fallen behind
			}
		},
	}

	device, err := malgo.InitDevice(ctx.Context, cfg, callbacks)
	if err != nil {
		ctx.Uninit()
		ctx.Free()
		return nil, err
	}
	s.device = device

	if err := device.Start(); err != nil {
		device.Uninit()
		ctx.Uninit()
		ctx.Free()
		return nil, err
	}
	return s, nil
}

// Level returns the current smoothed audio level (0..=1).
func (s *Session) Level() float32 {
	return math.Float32frombits(s.level.Load())
}

// Stop stops and releases the capture device.
func (s *Session) Stop() {
	if s.device != nil {
		s.device.Stop()
		s.device.Uninit()
		s.device = nil
	}
	if s.ctx != nil {
		s.ctx.Uninit()
		s.ctx.Free()
		s.ctx = nil
	}
}

func updateLevel(s *Session, samples []float32) float32 {
	rms := dsp.RMS(samples)
	scaled := rms * 8.0
	if scaled > 1.0 {
		scaled = 1.0
	}

	cur := math.Float32frombits(s.smoothing.Load())
	if scaled > cur {
		cur += (scaled - cur) * 0.5
	} else {
		cur += (scaled - cur) * 0.3
	}
	if cur < 0 {
		cur = 0
	}
	if cur > 1 {
		cur = 1
	}
	s.smoothing.Store(math.Float32bits(cur))
	return cur
}
