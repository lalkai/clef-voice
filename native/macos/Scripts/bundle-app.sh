#!/bin/bash
# bundle-app.sh — Builds the Go core engine (clefd) and the Swift shell, then wraps
# them into a proper .app bundle. This is necessary for macOS Accessibility /
# Hotkey / Microphone permissions to work.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MACOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CORE_DIR="$PROJECT_ROOT/core"

node "$PROJECT_ROOT/scripts/sync-config.mjs"
APP_NAME="$(node "$PROJECT_ROOT/scripts/sync-config.mjs" --get name)"
BUNDLE_ID="$(node "$PROJECT_ROOT/scripts/sync-config.mjs" --get bundleIdentifier)"
APP_DIR="$MACOS_DIR/$APP_NAME.app"
APP_VERSION="$(node "$PROJECT_ROOT/scripts/sync-config.mjs" --get version)"

# 1. Build the Go core engine (whisper.cpp + clefd)
echo "🐹 Building Go core engine (clefd)..."
make -C "$CORE_DIR" build
CLEFD_BIN="$CORE_DIR/build/clefd"
if [ ! -f "$CLEFD_BIN" ]; then
    echo "❌ clefd binary not found at $CLEFD_BIN"
    exit 1
fi

# 2. Build the web UI (React)
echo "🌐 Building web UI (React)..."
(cd "$PROJECT_ROOT" && npm --prefix app run build)
WEB_DIST="$PROJECT_ROOT/app/dist"
if [ ! -f "$WEB_DIST/index.html" ]; then
    echo "❌ web UI build not found at $WEB_DIST"
    exit 1
fi

# 3. Build the Swift shell
cd "$MACOS_DIR"
echo "Building ClefVoice..."
swift build
BUILD_DIR="$(swift build --show-bin-path)"

# 4. Assemble the app bundle
echo "Creating app bundle..."
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# Copy binaries
cp "$BUILD_DIR/ClefVoice" "$APP_DIR/Contents/MacOS/$APP_NAME"
cp "$CLEFD_BIN" "$APP_DIR/Contents/MacOS/clefd"

# Copy app icon (committed under Assets/)
if [ -f "Assets/AppIcon.icns" ]; then
    cp "Assets/AppIcon.icns" "$APP_DIR/Contents/Resources/AppIcon.icns"
else
    echo "Warning: Assets/AppIcon.icns not found."
fi

# Copy menu bar icon
if [ -f "Assets/MenuBarIcon.png" ]; then
    cp "Assets/MenuBarIcon.png" "$APP_DIR/Contents/Resources/MenuBarIcon.png"
else
    echo "Warning: Assets/MenuBarIcon.png not found."
fi

# Copy web UI
mkdir -p "$APP_DIR/Contents/Resources/web"
cp -R "$WEB_DIST/." "$APP_DIR/Contents/Resources/web/"

# Create Info.plist
cat > "$APP_DIR/Contents/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>$APP_NAME</string>
    <key>CFBundleIdentifier</key>
    <string>$BUNDLE_ID</string>
    <key>CFBundleName</key>
    <string>$APP_NAME</string>
    <key>CFBundleDisplayName</key>
    <string>$APP_NAME</string>
    <key>CFBundleShortVersionString</key>
    <string>$APP_VERSION</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSUIElement</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>ClefVoice needs microphone access for local speech-to-text dictation.</string>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsLocalNetworking</key>
        <true/>
    </dict>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
EOF

# Ad-hoc signing is for local development builds.
codesign --force --deep --sign - "$APP_DIR"

echo ""
echo "✅ Built: $APP_DIR"
