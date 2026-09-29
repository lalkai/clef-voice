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
