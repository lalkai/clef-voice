import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const configSource = await readFile(new URL('../src/lib/appConfig.generated.ts', import.meta.url), 'utf8');
const configText = ts.transpileModule(configSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const configURL = `data:text/javascript;base64,${Buffer.from(configText).toString('base64')}`;
const bundledAPI = outputText.replace('"./appConfig.generated"', JSON.stringify(configURL));
const api = await import(`data:text/javascript;base64,${Buffer.from(bundledAPI).toString('base64')}`);

globalThis.window = new EventTarget();
// Also supports Node 18, which does not expose CustomEvent globally.
globalThis.CustomEvent ??= class extends Event {
  constructor(type, options) {
    super(type);
    this.detail = options?.detail;
  }
};

test('browser defaults match shared defaults and snapshots cannot mutate them', async () => {
  const { appConfig } = await import(configURL);
  const settings = await api.getSettings();
  for (const [key, value] of Object.entries(appConfig.settingsDefaults)) assert.deepEqual(settings[key], value);
  assert.equal(settings.vadThreshold, appConfig.defaultVadThreshold);
  settings.customVocabulary.push('must not leak');
  assert.ok(!(await api.getSettings()).customVocabulary.includes('must not leak'));
  let confirmed;
  window.addEventListener('clefVoice:settings', event => { confirmed = event.detail; }, {once:true});
  await api.updateSettings({autoStopSeconds:1.2});
  assert.equal(confirmed.autoStopSeconds,1.2);
});

test('browser settings retain independent patches and auto-detect selection', async () => {
  await api.updateSettings({ hotkey: 'Fn' });
  await api.updateSettings({ selectedLanguages: [] });
  const settings = await api.getSettings();
  assert.equal(settings.hotkey, 'Fn');
  assert.deepEqual(settings.selectedLanguages, []);
  assert.ok(!(await api.getLanguages()).some((language) => language.code === 'auto'));
});

test('browser favorites change history without changing measurements', async () => {
  const items = await api.getHistory();
  const stats = await api.getStats();
  assert.equal(stats.averageProcessingSeconds, 1);
  await api.setHistoryFavorite(items[0].id, true);
  assert.equal((await api.getHistory())[0].favorite, true);
  assert.deepEqual(await api.getStats(), stats);
  await api.setHistoryFavorite(items[0].id, false);
  assert.equal((await api.getHistory())[0].favorite, false);
});

test('browser history mutations update data and statistics', async () => {
  const items = await api.getHistory();
  let stats;
  window.addEventListener('clefVoice:stats', (event) => { stats = event.detail; });
  await api.deleteHistoryItem(items[0].id);
  assert.equal((await api.getHistory()).length, items.length - 1);
  assert.equal(stats.dictationCount, items.length - 1);
  await api.clearHistory();
  assert.deepEqual(await api.getHistory(), []);
  assert.equal(stats.totalWords, 0);
  assert.deepEqual(stats.activeDays, []);
  assert.equal(stats.averageProcessingSeconds, undefined);
  assert.deepEqual(await api.getStats(), stats);
});

test('native settings receive only the changed fields', async () => {
  let received;
  window.clefVoice = { call: async (...args) => { received = args; } };
  await api.updateSettings({ autoStopEnabled: false });
  assert.deepEqual(received, ['updateSettings', { settings: { autoStopEnabled: false } }]);
  delete window.clefVoice;
});

test('browser model actions keep download separate from selection and allow deleting every model', async () => {
  assert.deepEqual((await api.getSettings()).selectedLanguages, []);
  const initial = await api.getModels();
  assert.equal(initial.items.find((item) => item.id === 'base').active, true);
  await assert.rejects(api.loadModel('small'), /Download this model first/);
  assert.equal((await api.getSettings()).modelSize, 'base');
  let snapshot;
  window.addEventListener('clefVoice:models', (event) => { snapshot = event.detail; });
  const downloading = api.downloadModel('small');
  assert.equal(snapshot.busy, true);
  assert.equal(snapshot.items.find((item) => item.id === 'small').status, 'downloading');
  await assert.rejects(api.loadModel('small'), /busy/);
  assert.equal((await api.getSettings()).modelSize, 'base');
  await downloading;
  assert.equal(snapshot.items.find((item) => item.id === 'small').downloaded, true);
  assert.equal((await api.getSettings()).modelSize, 'base');
  await api.loadModel('small');
  assert.equal(snapshot.items.find((item) => item.id === 'small').active, true);
  assert.equal((await api.getSettings()).modelSize, 'small');
  await api.deleteModel('base');
  assert.equal(snapshot.items.find((item) => item.id === 'base').status, 'not_downloaded');
  await api.deleteModel('small');
  assert.equal(snapshot.items.find((item) => item.id === 'small').downloaded, false);
  assert.equal(snapshot.items.some((item) => item.active), false);
});

test('copy uses the macOS clipboard and reports native failures', async () => {
  let received;
  window.clefVoice = { call: async (...args) => { received = args; return true; } };
  try {
    await api.copyText('ข้อความใหม่');
    assert.deepEqual(received, ['copyText', { text: 'ข้อความใหม่' }]);
    window.clefVoice.call = async () => false;
    await assert.rejects(api.copyText('ข้อความใหม่'), /Could not copy text/);
  } finally {
    delete window.clefVoice;
  }
});

test('browser copy waits for clipboard completion and propagates rejection', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let complete;
  let written;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    clipboard: { writeText: (text) => { written = text; return new Promise((resolve) => { complete = resolve; }); } },
  } });
  try {
    let finished = false;
    const copying = api.copyText('new transcript').then(() => { finished = true; });
    await Promise.resolve();
    assert.equal(written, 'new transcript');
    assert.equal(finished, false);
    complete();
    await copying;
    assert.equal(finished, true);
    navigator.clipboard.writeText = async () => { throw new Error('Permission denied'); };
    await assert.rejects(api.copyText('new transcript'), /Permission denied/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

test('first-run completion is remembered only after a downloaded model is active', async () => {
  const entries = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  try {
    assert.deepEqual(await api.getSetupState(), { completed: false });
    await api.downloadModel('tiny');
    assert.equal(await api.completeSetup(), false);
    assert.deepEqual(await api.getSetupState(), { completed: false });
    await new Promise((resolve) => setTimeout(resolve, 750));
    await api.loadModel('tiny');
    assert.equal(await api.completeSetup(), true);
    assert.deepEqual(await api.getSetupState(), { completed: true });
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test('setup status and completion use the native bridge on macOS', async () => {
  const requests = [];
  window.clefVoice = { call: async (method) => {
    requests.push(method);
    return method === 'getSetupState' ? { completed: false } : false;
  } };
  try {
    assert.deepEqual(await api.getSetupState(), { completed: false });
    assert.equal(await api.completeSetup(), false);
    assert.deepEqual(requests, ['getSetupState', 'completeSetup']);
  } finally { delete window.clefVoice; }
});


test('packaged app never substitutes preview data for a missing native bridge', async () => {
  window.location = { protocol: 'file:' };
  try {
    await assert.rejects(api.getSettings(), /native bridge/i);
    await assert.rejects(api.checkPermissions(), /native bridge/i);
  } finally { delete window.location; }
});

test('browser download completion supports the setup download-and-use sequence', async () => {
  await api.deleteModel('tiny');
  const download = api.downloadModel('tiny');
  await assert.rejects(api.loadModel('tiny'), /busy/i);
  await download;
  await api.loadModel('tiny');
  const model = (await api.getModels()).items.find(item => item.id === 'tiny');
  assert.equal(model.downloaded, true);
  assert.equal(model.active, true);
});
