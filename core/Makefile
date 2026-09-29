BINARY = clefd
OUT = build/$(BINARY)

ifeq ($(shell uname -s),Darwin)
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
