import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const compile = (source) => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const config = compile(await readFile(new URL('../src/lib/appConfig.generated.ts', import.meta.url), 'utf8')).replace(/^export /gm, '');
const source = compile(await readFile(new URL('../src/lib/vocabulary.ts', import.meta.url), 'utf8')).replace(/import \{ appConfig \} from ["']\.\/appConfig.generated["'];?/, config);
const {normalizeVocabulary, vocabularyError} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('vocabulary trims/deduplicates and counts Unicode code points', () => {
 assert.deepEqual(normalizeVocabulary([' ไทย ', 'ไทย', '', '😀']), ['ไทย', '😀']);
 assert.equal(vocabularyError(['😀'.repeat(64)]), '');
 assert.match(vocabularyError(['ก'.repeat(65)]), /64 Unicode/);
 assert.match(vocabularyError(Array(65).fill('a')), /64 words/);
 assert.match(vocabularyError(Array(9).fill('ก'.repeat(64))), /512 Unicode/);
});
