import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/audioSettings.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { audioOptionValue } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('sensitivity stays selected after a float32 bridge round trip', () => {
  const presets = [0.005, 0.012, 0.025];
  for (const value of presets) {
    assert.equal(audioOptionValue(Math.fround(value), presets), String(value));
  }
  assert.equal(audioOptionValue(0.02, presets), '0.02');
  assert.equal(audioOptionValue(1.2, [0.6, 0.9, 1.2, 1.5]), '1.2');
});
