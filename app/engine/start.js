import {createNativeEngine} from './src/app/native-engine.js';

const send = message => window.webkit.messageHandlers.stylio.postMessage(message);
globalThis.stylioNative = createNativeEngine(event => send({type: 'progress', ...event}));
send({type: 'ready', isolated: globalThis.crossOriginIsolated});
