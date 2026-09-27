package whisper

/*
#cgo CFLAGS: -O3 -I${SRCDIR}/../../third_party/whisper.cpp/include -I${SRCDIR}/../../third_party/whisper.cpp/ggml/include
#cgo darwin LDFLAGS: -L${SRCDIR}/../../build/whisper/lib -lwhisper -lggml -lggml-base -lggml-cpu -lggml-metal -lggml-blas -framework Foundation -framework Metal -framework MetalKit -framework Accelerate -lc++ -lobjc
#cgo linux LDFLAGS: -L${SRCDIR}/../../build/whisper/lib -lwhisper -lggml -lggml-base -lggml-cpu -lggml-blas -lm -lstdc++ -lpthread
#include <stdlib.h>
#include "whisper_bridge.h"
*/
import "C"

import (
	"errors"
	"strings"
	"unsafe"
)

// Engine wraps a whisper.cpp context.
type Engine struct {
	ctx unsafe.Pointer
}

// NewEngine loads a whisper model from the given path.
func NewEngine(path string, useGPU bool) (*Engine, error) {
	cpath := C.CString(path)
	defer C.free(unsafe.Pointer(cpath))

	ctx := C.cv_whisper_init(cpath, C.bool(useGPU))
	if ctx == nil {
		return nil, errors.New("failed to initialize whisper context")
	}
	return &Engine{ctx: ctx}, nil
}

// Close frees the underlying whisper context.
func (e *Engine) Close() {
	if e.ctx != nil {
		C.cv_whisper_free(e.ctx)
		e.ctx = nil
	}
}

// Transcribe runs whisper on the 16 kHz mono float PCM samples. language may be
// "" for auto-detection. Returns the concatenated segment text.
func (e *Engine) Transcribe(samples []float32, language, prompt string, nThreads int) (string, error) {
	if e.ctx == nil {
		return "", errors.New("model is not loaded")
	}
	if len(samples) == 0 {
		return "", errors.New("empty audio buffer")
	}

	var cLang, cPrompt *C.char
	if language != "" {
		cLang = C.CString(language)
		defer C.free(unsafe.Pointer(cLang))
	}
	if prompt != "" {
		cPrompt = C.CString(prompt)
		defer C.free(unsafe.Pointer(cPrompt))
	}

	samplesPtr := (*C.float)(unsafe.Pointer(&samples[0]))

	out := C.cv_whisper_transcribe(e.ctx, samplesPtr, C.int(len(samples)), cLang, cPrompt, C.int(nThreads))
	if out == nil {
		return "", errors.New("whisper_full failed")
	}
	defer C.free(unsafe.Pointer(out))

	return strings.TrimSpace(C.GoString(out)), nil
}
