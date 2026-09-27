#ifndef CV_WHISPER_BRIDGE_H
#define CV_WHISPER_BRIDGE_H

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

// Create a whisper context from a model file. Returns NULL on failure.
void *cv_whisper_init(const char *path, bool use_gpu);

// Free a context returned by cv_whisper_init.
void cv_whisper_free(void *ctx);

// Transcribe raw 16 kHz mono float PCM. `language` may be NULL/"" for
// auto-detection; `initial_prompt` may be NULL/"" for none.
// Returns a malloc'd UTF-8 string (caller frees with free()) or NULL on error.
char *cv_whisper_transcribe(void *ctx, const float *samples, int n_samples,
                            const char *language, const char *initial_prompt,
                            int n_threads);

#ifdef __cplusplus
}
#endif

#endif
