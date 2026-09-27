# Makefile for ClefVoice

APP_NAME = ClefVoice
APP_BUNDLE = $(APP_NAME).app
INSTALL_PATH = /Applications/$(APP_BUNDLE)

.PHONY: all build run install test clean help

all: build

help:
	@echo "Available commands:"
	@echo "  make build      - Build and bundle the application into $(APP_BUNDLE)"
	@echo "  make run        - Open/Run the compiled application"
	@echo "  make install    - Install $(APP_BUNDLE) permanently to $(INSTALL_PATH)"
	@echo "  make test       - Run Swift tests"
	@echo "  make clean      - Clean build artifacts, Swift cache, and build directory"
	@echo "  make help       - Show this help message"

build:
	@echo "Building $(APP_NAME) bundle..."
	./Scripts/bundle-app.sh

run: build
	@echo "Launching $(APP_NAME)..."
	open $(APP_BUNDLE)

install: build
	@echo "Installing $(APP_BUNDLE) to $(INSTALL_PATH)..."
	rm -rf "$(INSTALL_PATH)"
	cp -r "$(APP_BUNDLE)" "/Applications/"
	@echo "✅ Installed successfully!"

test:
	swift test

clean:
	@echo "Cleaning Swift build and bundle artifacts..."
	swift package clean
	rm -rf .build
	rm -rf "$(APP_BUNDLE)"
	@echo "✨ Cleaned successfully!"
