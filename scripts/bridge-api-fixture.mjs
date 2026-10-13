// Compile the production API for WKWebView contract tests without writing build output.
import { readFile } from 'node:fs/promises';
import ts from '../app/node_modules/typescript/lib/typescript.js';
const compile = async (path) => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const config = (await compile('../app/src/lib/appConfig.generated.ts')).replace(/^export /gm, '');
const api = (await compile('../app/src/lib/api.ts'))
  .replace(/import \{ appConfig \} from ["']\.\/appConfig.generated["'];?/, config)
  .replace(/^export /gm, '');
process.stdout.write(`(function () { ${api}\nwindow.testAPI = { copyText, completeSetup }; })();`);
