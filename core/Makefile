BINARY = clefd
OUT = build/$(BINARY)

ifeq ($(shell uname -s),Darwin)
export MACOSX_DEPLOYMENT_TARGET = 13.0
# Explicit flags also invalidate Go's cached cgo objects from newer SDK defaults.
CGO_CFLAGS ?= -O2 -g
CGO_CXXFLAGS ?= -O2 -g
CGO_LDFLAGS ?= -O2 -g
export CGO_CFLAGS += -mmacosx-version-min=13.0
export CGO_CXXFLAGS += -mmacosx-version-min=13.0
export CGO_LDFLAGS += -mmacosx-version-min=13.0
export SDKROOT ?= $(shell xcrun --sdk macosx --show-sdk-path)
endif

.PHONY: all build config whisper clean test

all: build

# Build whisper.cpp static libs, then the Go daemon.
build: config whisper
	CGO_ENABLED=1 go build -o $(OUT) ./cmd/clefd

config:
	node ../scripts/sync-config.mjs

whisper:
	./scripts/build-whisper.sh

test: config
	go test ./...

clean:
	rm -rf build
