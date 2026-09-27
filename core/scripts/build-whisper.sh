#!/bin/bash
# build-whisper.sh — builds whisper.cpp as static libraries and collects them
# into build/whisper/lib for the Go cgo wrapper to link against.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WCPP="$ROOT/third_party/whisper.cpp"
BUILD="$ROOT/build/whisper"
CMAKE_BUILD="$BUILD/cmake"
LIB="$BUILD/lib"

# Fetch whisper.cpp at a pinned version if it isn't vendored yet.
WHISPER_VERSION="${WHISPER_VERSION:-v1.9.3}"
if [ ! -f "$WCPP/CMakeLists.txt" ]; then
    echo "whisper.cpp not found; cloning $WHISPER_VERSION..."
    git clone --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggerganov/whisper.cpp.git "$WCPP"
fi

mkdir -p "$LIB"

# Rebuild only if the CMake cache is missing.
if [ ! -f "$CMAKE_BUILD/CMakeCache.txt" ]; then
    echo "Configuring whisper.cpp..."
    cmake -S "$WCPP" -B "$CMAKE_BUILD" \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHARED_LIBS=OFF \
        -DWHISPER_BUILD_TESTS=OFF \
        -DWHISPER_BUILD_EXAMPLES=OFF \
        -DGGML_BUILD_TESTS=OFF \
        -DGGML_BUILD_EXAMPLES=OFF \
        -DGGML_STANDALONE=OFF \
        -DGGML_METAL=ON \
        -DGGML_METAL_EMBED_LIBRARY=ON \
        -DGGML_BLAS=ON \
        > "$BUILD/cmake-configure.log" 2>&1
fi

echo "Building whisper.cpp..."
cmake --build "$CMAKE_BUILD" --target whisper -j "$(sysctl -n hw.ncpu 2>/dev/null || echo 4)" > "$BUILD/cmake-build.log" 2>&1

# Collect the static libraries into a single directory.
find "$CMAKE_BUILD" -name 'libwhisper.a' -o -name 'libggml*.a' | while read -r lib; do
    cp "$lib" "$LIB/"
done

echo "whisper.cpp libraries ready in $LIB"
ls -la "$LIB"
