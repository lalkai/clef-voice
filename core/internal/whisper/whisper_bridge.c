#include "whisper_bridge.h"

#include "whisper.h"

#include <stdlib.h>
#include <string.h>

void *cv_whisper_init(const char *path, bool use_gpu) {
    struct whisper_context_params cparams = whisper_context_default_params();
    cparams.use_gpu = use_gpu;
    // Flash attention crashes on pre-M5 / pre-A19 Apple Silicon with Metal.
    cparams.flash_attn = false;
    return whisper_init_from_file_with_params(path, cparams);
}

void cv_whisper_free(void *ctx) {
    if (ctx) {
        whisper_free((struct whisper_context *)ctx);
    }
}

char *cv_whisper_transcribe(void *ctx, const float *samples, int n_samples,
                            const char *language, const char *initial_prompt,
                            int n_threads) {
    struct whisper_context *c = (struct whisper_context *)ctx;

    struct whisper_full_params params =
        whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.print_special = false;
    params.print_progress = false;
    params.print_realtime = false;
    params.print_timestamps = false;
    params.translate = false;
    params.temperature = 0.0f;
    params.suppress_blank = true;
    params.suppress_nst = true;
    params.no_speech_thold = 0.6f;
    // No per-segment token cap.
    params.max_tokens = 0;
    params.no_context = true;
    params.single_segment = false;
    params.n_threads = n_threads;
    params.greedy.best_of = 1;

    // NULL / "" / "auto" => auto-detect language (and continue decoding,
    // unlike the separate detect_language flag which returns early).
    params.language = (language && language[0]) ? language : NULL;
    params.initial_prompt =
        (initial_prompt && initial_prompt[0]) ? initial_prompt : NULL;

    if (whisper_full(c, params, samples, n_samples) != 0) {
        return NULL;
    }

    int n_segments = whisper_full_n_segments(c);
    size_t total = 1;
    for (int i = 0; i < n_segments; i++) {
        const char *t = whisper_full_get_segment_text(c, i);
        if (t) {
            total += strlen(t);
        }
    }

    char *out = (char *)malloc(total);
    if (!out) {
        return NULL;
    }
    out[0] = '\0';
    for (int i = 0; i < n_segments; i++) {
        const char *t = whisper_full_get_segment_text(c, i);
        if (t) {
            strcat(out, t);
        }
    }
    return out;
}
