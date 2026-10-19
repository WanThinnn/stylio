import fs from 'node:fs/promises';
import {discoverHeic,extractItemData,auxUriForItem} from '../web/src/raster/heif.js';
const file=process.argv[2],bytes=new Uint8Array(await fs.readFile(file)),d=discoverHeic(bytes);
const apple=d.hdrGrid,refs=d.refs.filter(r=>r.type==='cdsc'&&r.to.includes(apple)&&d.infos.get(r.from)?.type==='mime');
const xml=refs.map(r=>new TextDecoder().decode(extractItemData(bytes,d,r.from)));
const version=xml.map(x=>x.match(/HDRGainMapVersion>(\d+)/)?.[1]).filter(Boolean);
const headroom=xml.map(x=>x.match(/HDRGainMapHeadroom>([^<]+)/)?.[1]).filter(Boolean);
console.log(JSON.stringify({appleGrid:apple,appleAux:auxUriForItem(d.props,apple),appleTargets:d.refs.filter(r=>r.type==='auxl'&&r.from===apple).map(r=>r.to),sidecars:refs.map(r=>r.from),version,headroom,linearThumb:d.linearThumb,linearTargets:d.refs.filter(r=>r.type==='auxl'&&r.from===d.linearThumb).map(r=>r.to)},null,2));