import { build } from '../app/node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';
const result = await build({
  stdin: { contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import FirstRunSetup from './src/FirstRunSetup';
    import {useAppStore} from './src/lib/store';
    import {appConfig} from './src/lib/appConfig.generated';
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    useAppStore.getState().setStatus('idle','');
    window.testSetup = {
      completed: false,
      setStatus: (status, message) => useAppStore.getState().setStatus(status, message),
      inventory: {items: appConfig.models.map(model => ({...model, id:model.id, status:'downloaded', downloaded:true, present:true, active:model.id==='base', progress:1, receivedBytes:0,totalBytes:0})), busy:false, generation:1, connected:true},
      render(inventory) { root.render(React.createElement(FirstRunSetup, {permissions:{microphone:true,accessibility:true}, inventory:inventory || this.inventory, onRecheck:async()=>{}, onComplete:()=>{this.completed=true}})); },
    };
    window.testSetup.render();
  `, resolveDir: fileURLToPath(new URL('../app/', import.meta.url)), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: {'process.env.NODE_ENV':'"test"'},
});
process.stdout.write(result.outputFiles[0].text);
