BINARY = clefd
OUT = build/$(BINARY)

ifeq ($(shell uname -s),Darwin)
export SDKROOT ?= $(shell xcrun --sdk macosx --show-sdk-path)
endif

.PHONY: all build whisper clean test

all: build

# Build whisper.cpp static libs, then the Go daemon.
build: whisper
	CGO_ENABLED=1 go build -o $(OUT) ./cmd/clefd

whisper:
	./scripts/build-whisper.sh

test:
	go test ./...

clean:
	rm -rf build
