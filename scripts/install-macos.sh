#!/bin/bash
set -euo pipefail

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
[ "$(uname -s)" = Darwin ] || fail "This installer requires macOS."

version=latest
local_app=
install_dir=/Applications
while [ "$#" -gt 0 ]; do
    case "$1" in
        --version|--local|--dir)
            [ "$#" -ge 2 ] || fail "Missing value for $1."
            case "$1" in
                --version) version="$2" ;;
                --local) local_app="$2" ;;
                --dir) install_dir="$2" ;;
            esac
            shift 2 ;;
        *) fail "Usage: install-macos.sh [--version X.Y.Z] [--local APP_PATH] [--dir DIRECTORY]" ;;
    esac
done

work=$(mktemp -d "${TMPDIR:-/tmp}/clefvoice-download.XXXXXX")
staging=
backup=
destination=
cleanup() {
    if [ -n "$backup" ] && [ -e "$backup" ] && [ ! -e "$destination" ]; then
        mv "$backup" "$destination" || { printf 'Previous app retained at %s\n' "$backup" >&2; return; }
    fi
    [ -z "$staging" ] || rm -rf "$staging"
    rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ -n "$local_app" ]; then
    [ -d "$local_app" ] || fail "Build the app first: npm run build"
    project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
    config="$project_root/app.config.json"
    source_app="$local_app"
else
    case "$(uname -m)" in
        arm64|x86_64) arch=$(uname -m) ;;
        *) fail "Unsupported Mac architecture." ;;
    esac
    repo=https://github.com/lalkai/clef-voice
    if [ "$version" = latest ]; then
        release_url=$(curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 60 --output /dev/null --write-out '%{url_effective}' "$repo/releases/latest")
        case "$release_url" in "$repo/releases/tag/"*) version="${release_url##*/}" ;; *) fail "No published release found." ;; esac
    fi
    version="v${version#v}"
    [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Use a release version such as 0.4.1."
    config="$work/app.config.json"
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 60 \
        "https://raw.githubusercontent.com/lalkai/clef-voice/$version/app.config.json" --output "$config"
    app_name=$(plutil -extract name raw -o - "$config")
    [[ "$app_name" =~ ^[A-Za-z][A-Za-z0-9-]*$ ]] || fail "Invalid app name."
    [ "$(plutil -extract version raw -o - "$config")" = "${version#v}" ] || fail "Release tag does not match its configuration."
    printf 'Downloading %s %s (%s)…\n' "$app_name" "$version" "$arch"
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 600 \
        "$repo/releases/download/$version/$app_name-$version-macOS-$arch.zip" --output "$work/release.zip"
    ditto -x -k "$work/release.zip" "$work/unpacked"
    source_app="$work/unpacked/$app_name.app"
fi

app_name=$(plutil -extract name raw -o - "$config")
bundle_id=$(plutil -extract bundleIdentifier raw -o - "$config")
expected_version=$(plutil -extract version raw -o - "$config")
[[ "$app_name" =~ ^[A-Za-z][A-Za-z0-9-]*$ ]] || fail "Invalid app name."
[ -d "$source_app" ] || fail "Release does not contain $app_name.app."
plist="$source_app/Contents/Info.plist"
[ "$(plutil -extract CFBundleIdentifier raw -o - "$plist")" = "$bundle_id" ] || fail "Unexpected app bundle."
[ "$(plutil -extract CFBundleShortVersionString raw -o - "$plist")" = "$expected_version" ] || fail "App version does not match its release configuration."
codesign --verify --deep --strict "$source_app"

if [ "$install_dir" = /Applications ] && [ ! -w "$install_dir" ]; then
    install_dir="$HOME/Applications"
fi
mkdir -p "$install_dir"
destination="$install_dir/$app_name.app"
if [ -e "$destination" ]; then
    [ "$(plutil -extract CFBundleIdentifier raw -o - "$destination/Contents/Info.plist")" = "$bundle_id" ] || fail "Refusing to replace an unrelated app."
fi
staging=$(mktemp -d "$install_dir/.clefvoice-install.XXXXXX")
ditto "$source_app" "$staging/$app_name.app"
xattr -dr com.apple.quarantine "$staging/$app_name.app"
backup="$staging/previous.app"
[ ! -e "$destination" ] || mv "$destination" "$backup"
mv "$staging/$app_name.app" "$destination"
printf 'Installed %s %s at %s\n' "$app_name" "$expected_version" "$destination"
printf 'Open the app with: open "%s"\n' "$destination"
