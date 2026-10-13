import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/modelFilters.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { filterModels, isLocalModel, sortLocalModels } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const config = JSON.parse(await readFile(new URL("../../app.config.json", import.meta.url), "utf8"));
const items = config.models.map((model) => ({ ...model, name: model.displayName, present: false, downloaded: false, active: false, status: "not_downloaded" }));
const descriptions = Object.fromEntries(config.models.map((model) => [model.id, model.description]));
test("language coverage filtering separates multilingual, English-only and specialized models", () => {
  const multilingual = filterModels(items, "", "multilingual", descriptions);
  assert.ok(multilingual.length > 0);
  assert.ok(multilingual.every((model) => !model.id.endsWith("-en") && model.id !== "breeze-asr"));
  assert.equal(filterModels(items, "", "english", descriptions).length, 4);
  assert.deepEqual(filterModels(items, "", "specialized", descriptions).map((m) => m.id), ["breeze-asr"]);
  assert.deepEqual(filterModels(items, " BREEZE ", "all", descriptions).map((m) => m.id), ["breeze-asr"]);
  assert.equal(filterModels(items, "breeze", "multilingual", descriptions).length, 0);
  assert.equal(filterModels(items, "nothing matches", "all", descriptions).length, 0);
});
test("local models include failed existing files and in-progress downloads, with active first", () => {
  const local = [{ ...items[0], present: true, status: "failed" }, { ...items[1], active: true, downloaded: true }, { ...items[2], status: "downloading" }];
  assert.ok(local.every(isLocalModel));
  assert.ok(!isLocalModel(items[3]));
  assert.equal(sortLocalModels(local)[0].id, items[1].id);
  assert.equal(local[0].id, items[0].id);
});
