import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/modelLanguages.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { modelLanguageSelection } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const languages = [{ code: "en", name: "English" }, { code: "th", name: "Thai" }, { code: "zh", name: "Chinese" }];
test("English-only selection matches the engine without overwriting multilingual preferences", () => {
  const configured = ["th", "en"];
  const selection = modelLanguageSelection({ languages: ["en"] }, languages, configured);
  assert.deepEqual(selection, { available: [languages[0]], selected: ["en"], fixed: true });
  assert.deepEqual(modelLanguageSelection({ languages: [] }, languages, configured).selected, configured);
  assert.deepEqual(configured, ["th", "en"]);
});
test("specialized models filter unavailable preferences and retain auto detection", () => {
  const model = { languages: ["zh", "en"] };
  assert.deepEqual(modelLanguageSelection(model, languages, ["th"]).selected, []);
  assert.deepEqual(modelLanguageSelection(model, languages, ["th", "zh"]).selected, ["zh"]);
  assert.deepEqual(modelLanguageSelection(model, languages, []).available, [languages[0], languages[2]]);
});
test("no active model does not present selectable languages", () => {
  assert.deepEqual(modelLanguageSelection(undefined, languages, ["th"]), { available: [], selected: [], fixed: false });
});
