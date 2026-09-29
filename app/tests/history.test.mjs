import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/history.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { filterHistory, historyTimestamp, formatProcessingTime } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('search finds mixed Thai/English terms in any order and combines with favorites', () => {
  const items = [
    { id: 'thai', text: 'คอปเตอร์ใช้ PostgreSQL กับ React', favorite: true },
    { id: 'en', text: 'Use React with TypeScript' },
    { id: 'unicode', text: 'café' },
  ];
  assert.deepEqual(filterHistory(items, ' react   คอปเตอร์ ', false).map((item) => item.id), ['thai']);
  assert.deepEqual(filterHistory(items, 'REACT', true).map((item) => item.id), ['thai']);
  assert.equal(filterHistory(items, 'cafe\u0301', false)[0].id, 'unicode');
  assert.equal(filterHistory(items, '  ', false).length, 3);
});

test('legacy timestamps and missing measurements do not invent dates or zero latency', () => {
  const legacy = { timestamp: '10:42 AM' };
  assert.equal(historyTimestamp(legacy), '10:42 AM');
  assert.equal(historyTimestamp({ ...legacy, createdAt: '0001-01-01T00:00:00Z' }), '10:42 AM');
  assert.equal(historyTimestamp({ ...legacy, createdAt: 'bad date' }), '10:42 AM');
  assert.equal(formatProcessingTime(undefined), '—');
  assert.equal(formatProcessingTime(NaN), '—');
  assert.equal(formatProcessingTime(-1), '—');
  assert.equal(formatProcessingTime(0), '0 ms');
  assert.equal(formatProcessingTime(0.3), '300 ms');
});
