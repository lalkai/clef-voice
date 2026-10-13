import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const config = JSON.parse(readFileSync(join(root, 'app.config.json'), 'utf8'));
const installer = join(root, 'scripts/install-macos.sh');
const options = { skip: process.platform !== 'darwin' };

function fixture(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'clef-installer-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  const destination = join(directory, 'Applications');
  const app = join(directory, `${config.name}.app`);
  mkdirSync(bin);
  mkdirSync(destination);
  mkdirSync(join(app, 'Contents'), { recursive: true });
  writeFileSync(join(app, 'Contents/Info.plist'), JSON.stringify({
    CFBundleIdentifier: config.bundleIdentifier,
    CFBundleShortVersionString: config.version,
  }));
  const commands = {
    uname: 'if [ "$1" = -s ]; then echo Darwin; else echo "${TEST_ARCH:-arm64}"; fi',
    mv: 'case "$1" in */.clefvoice-install.*/' + config.name + '.app) [ "${TEST_RENAME_FAILURE:-0}" != 1 ] || exit 1 ;; esac; /bin/mv "$@"',
    codesign: 'exit "${TEST_SIGNATURE_FAILURE:-0}"',
    xattr: 'printf "%s\\n" "$*" >> "$TEST_LOG"; exit "${TEST_XATTR_FAILURE:-0}"',
    ditto: 'if [ "$1" = -x ]; then mkdir -p "$4"; cp -R "$TEST_APP" "$4/"; else cp -R "$1" "$2"; fi',
    curl: `printf '%s\\n' "$*" >> "$TEST_LOG"
if [ "\${TEST_DOWNLOAD_FAILURE:-0}" = 1 ]; then exit 22; fi
case "$*" in
  *url_effective*) printf 'https://github.com/lalkai/clef-voice/releases/tag/v${config.version}'; exit 0 ;;
esac
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in --output) output="$2"; shift 2 ;; https://*) url="$1"; shift ;; *) shift ;; esac
done
case "$url" in */app.config.json) cp "$TEST_CONFIG" "$output" ;; *) printf zip > "$output" ;; esac`,
  };
  for (const [name, body] of Object.entries(commands)) {
    writeFileSync(join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o755 });
  }
  const log = join(directory, 'calls.log');
  const environment = { ...process.env, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, TMPDIR: directory,
    TEST_LOG: log, TEST_APP: app, TEST_CONFIG: join(root, 'app.config.json'), ...overrides };
  return { directory, destination, app, log,
    run: (...args) => spawnSync('/bin/bash', [installer, '--dir', destination, ...args], { env: environment, encoding: 'utf8' }) };
}

for (const arch of ['arm64', 'x86_64']) {
  test(`release install selects ${arch} and removes quarantine only from its staged app`, options, t => {
    const f = fixture(t, { TEST_ARCH: arch });
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(f.destination, `${config.name}.app/Contents/Info.plist`)));
    const calls = readFileSync(f.log, 'utf8');
    assert.ok(calls.includes(`${config.name}-v${config.version}-macOS-${arch}.zip`));
    assert.match(calls, /-dr com\.apple\.quarantine .*\.clefvoice-install\./);
  });
}

for (const failure of ['TEST_SIGNATURE_FAILURE', 'TEST_XATTR_FAILURE', 'TEST_DOWNLOAD_FAILURE', 'TEST_RENAME_FAILURE']) {
  test(`${failure} preserves the previous app`, options, t => {
    const f = fixture(t, { [failure]: '1' });
    const previous = join(f.destination, `${config.name}.app`);
    mkdirSync(join(previous, 'Contents'), { recursive: true });
    writeFileSync(join(previous, 'Contents/Info.plist'), JSON.stringify({ CFBundleIdentifier: config.bundleIdentifier }));
    writeFileSync(join(previous, 'keep.txt'), 'previous app');
    const result = failure === 'TEST_DOWNLOAD_FAILURE' ? f.run() : f.run('--local', f.app);
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(join(previous, 'keep.txt'), 'utf8'), 'previous app');
  });
}

test('installer refuses an unrelated app at the destination', options, t => {
  const f = fixture(t);
  const previous = join(f.destination, `${config.name}.app`);
  mkdirSync(join(previous, 'Contents'), { recursive: true });
  writeFileSync(join(previous, 'Contents/Info.plist'), JSON.stringify({ CFBundleIdentifier: 'unrelated.app' }));
  const result = f.run('--local', f.app);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unrelated app/);
  assert.match(readFileSync(join(previous, 'Contents/Info.plist'), 'utf8'), /unrelated\.app/);
});

test('installer rejects a release tag/config version mismatch before replacing the app', options, t => {
  const f = fixture(t);
  const result = f.run('--version', '0.0.0');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release tag does not match/);
  assert.equal(existsSync(join(f.destination, `${config.name}.app`)), false);
});

test('local installer refuses a stale build after the config version changed', options, t => {
  const f = fixture(t);
  writeFileSync(join(f.app, 'Contents/Info.plist'), JSON.stringify({
    CFBundleIdentifier: config.bundleIdentifier, CFBundleShortVersionString: '0.0.0',
  }));
  const result = f.run('--local', f.app);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /App version does not match/);
  assert.equal(existsSync(join(f.destination, `${config.name}.app`)), false);
});

test('local update replaces the old bundle only after preparation succeeds', options, t => {
  const f = fixture(t);
  const previous = join(f.destination, `${config.name}.app`);
  mkdirSync(join(previous, 'Contents'), { recursive: true });
  writeFileSync(join(previous, 'Contents/Info.plist'), JSON.stringify({ CFBundleIdentifier: config.bundleIdentifier }));
  writeFileSync(join(previous, 'old.txt'), 'old build');
  const result = f.run('--local', f.app);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(previous, 'old.txt')), false);
  assert.equal(JSON.parse(readFileSync(join(previous, 'Contents/Info.plist'), 'utf8')).CFBundleShortVersionString, config.version);
});
