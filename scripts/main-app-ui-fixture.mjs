import { build } from '../app/node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';
const result = await build({
  stdin: { contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import MainApp from './src/MainApp';
    const container = document.createElement('div'); document.body.appendChild(container);
    createRoot(container).render(React.createElement(MainApp));
  `, resolveDir: fileURLToPath(new URL('../app/', import.meta.url)), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: {'process.env.NODE_ENV':'"test"'},
});
process.stdout.write(result.outputFiles[0].text);
