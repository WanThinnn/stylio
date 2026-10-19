import fs from 'node:fs/promises';
import {buildReferenceWhiteHagcPayload} from '../web/src/raster/hagc.js';
import {buildDisplayP3PqHagcIcc,inspectGeneratedPqIcc} from '../web/src/raster/pq-hagc-icc.js';

const out=process.argv[2]||'tests/private-fixtures/NativeStyles_DualExif_V1/staging/generated-pq-hagc.icc';
const baseline=Number(process.argv[3]||2.3965);
const icc=buildDisplayP3PqHagcIcc(buildReferenceWhiteHagcPayload(baseline));
await fs.writeFile(out,icc);
console.log(JSON.stringify({out,bytes:icc.length,baseline,...inspectGeneratedPqIcc(icc)},null,2));
