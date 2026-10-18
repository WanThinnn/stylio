import {applyStyleDisplayRgba} from '../../../web/src/recommend/style-display-render.js';
let data='';
for await(const chunk of process.stdin) data+=chunk;
const {rgba,candidates}=JSON.parse(data);
const outputs=candidates.map(candidate=>Array.from(applyStyleDisplayRgba(new Uint8ClampedArray(rgba),candidate)));
process.stdout.write(JSON.stringify(outputs));
