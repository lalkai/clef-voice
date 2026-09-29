import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/dashboard.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { activityWeeks, modelUsage } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('activity uses local calendar days and omits legacy, invalid, and future dates', () => {
  const now = new Date(2026, 8, 29, 12);
  const first = new Date(2026, 8, 28, 0, 1);
  const last = new Date(2026, 8, 28, 23, 59);
  const weeks = activityWeeks([
    { createdAt: first.toISOString() }, { createdAt: last.toISOString() },
    { timestamp: '10:42 AM' }, { createdAt: 'invalid' },
    { createdAt: '0001-01-01T00:00:00Z' },
    { createdAt: new Date(2026, 8, 30).toISOString() },
    { createdAt: new Date(2026, 0, 1).toISOString() },
  ], now);
  assert.equal(weeks.length, 12);
  assert.ok(weeks.every((week) => week.length === 7 && week[0].date.getDay() === 0));
  const days = weeks.flat();
  assert.equal(days.reduce((total, day) => total + day.count, 0), 2);
  assert.equal(days.find((day) => day.date.getTime() === new Date(2026, 8, 28).getTime()).count, 2);
  assert.ok(days.filter((day) => day.future).every((day) => day.count === 0));
});

test('activity remains in order across daylight saving and month boundaries', () => {
  const days = activityWeeks([], new Date(2026, 2, 15, 12)).flat();
  for (let i = 1; i < days.length; i++) {
    const next = new Date(days[i - 1].date);
    next.setDate(next.getDate() + 1);
    assert.equal(days[i].date.getTime(), next.getTime());
  }
});

test('model usage includes legacy unknown models and accounts for every saved session', () => {
  const usage = modelUsage([{ model: 'base' }, { model: 'tiny' }, { model: 'base' }, {}]);
  assert.deepEqual(usage[0], { model: 'base', count: 2, percent: 50 });
  assert.equal(usage.reduce((total, item) => total + item.percent, 0), 100);
  assert.equal(usage.find((item) => item.model === 'Unknown').count, 1);
  assert.deepEqual(modelUsage([]), []);
});
