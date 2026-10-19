// Deterministic Display-P3/PQ ICC v4.4 generator with SMPTE ST 2094-50 HAGC.
//
// The transform follows the standards-conformant HDR ICC construction used by
// Skia: PQ -> per-channel compression -> 11^3 maxRGB-aware CLUT -> Display-P3
// to XYZ D50. HAGC is carried independently as ICC v4.4 metadata.
//
// This module generates every byte from public colorimetric constants and the
// supplied HAGC payload. No Apple/native donor profile bytes are used.

import {buildHagcIccTag} from './hagc.js';

const enc=new TextEncoder();
const D50=[.9642,1,.8249];
const P3_TO_XYZ_D50=[
  [.515102,.291965,.157153],
  [.241182,.692236,.0665819],
  [-.00104941,.0418818,.784378],
];
const TONE_INPUT_MAX=1000/203;
const TONE_A=1/(TONE_INPUT_MAX*TONE_INPUT_MAX);
const ONE_CURVE=0xffff;
const ONE_XYZ=0x8000;

const text=s=>enc.encode(s);
const concat=parts=>{
  const n=parts.reduce((s,p)=>s+p.length,0),out=new Uint8Array(n);
  let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;
};
const four=s=>{
  if(s.length!==4)throw new Error('ICC fourCC must be four characters');
  return text(s);
};
const u16=n=>Uint8Array.of((n>>>8)&255,n&255);
const u32=n=>Uint8Array.of((n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255);
const fixed=value=>{
  const n=Math.max(-0x80000000,Math.min(0x7fffffff,Math.floor(value*65536+.5)))|0;
  return u32(n>>>0);
};
const pad4=bytes=>{
  const n=(bytes.length+3)&~3;
  if(n===bytes.length)return bytes;
  const out=new Uint8Array(n);out.set(bytes);return out;
};
const unit16=(x,one)=>Math.max(0,Math.min(one,Math.floor(x*one+.5)));

function writeMluc(value){
  const chars=[];
  for(const ch of value){const c=ch.codePointAt(0);if(c>0xffff)throw new Error('ICC text must fit UTF-16 BMP');chars.push(0,c);}
  const body=Uint8Array.from(chars);
  return pad4(concat([
    four('mluc'),new Uint8Array(4),u32(1),u32(12),four('enUS'),u32(body.length),u32(28),body,
  ]));
}
function writeXyz(x,y,z){return concat([four('XYZ '),new Uint8Array(4),fixed(x),fixed(y),fixed(z)]);}
function identityCurve(){return concat([four('para'),new Uint8Array(4),u16(0),u16(0),fixed(1)]);}
function tableCurve(values){
  const body=[];for(const v of values)body.push(u16(v));
  return pad4(concat([four('curv'),new Uint8Array(4),u32(values.length),...body]));
}
function writeMatrix(matrix){
  const parts=[];
  for(let r=0;r<3;r++)for(let c=0;c<3;c++)parts.push(fixed(matrix[r][c]));
  parts.push(fixed(0),fixed(0),fixed(0));
  return concat(parts);
}
function writeClut(grid,values){
  if(!Number.isInteger(grid)||grid<2||grid>255)throw new Error('Invalid ICC CLUT grid');
  if(values.length!==grid*grid*grid*3)throw new Error('ICC CLUT size mismatch');
  const head=new Uint8Array(20);head[0]=head[1]=head[2]=grid;head[16]=2;
  const body=new Uint8Array(values.length*2);
  for(let i=0;i<values.length;i++){body[i*2]=values[i]>>>8;body[i*2+1]=values[i]&255;}
  return pad4(concat([head,body]));
}
function writeMab(type,{bCurves,aCurves=null,grid=null,clutValues=null,mCurves=null,matrix=null}){
  if(!Array.isArray(bCurves)||bCurves.length!==3)throw new Error('ICC mAB requires three B curves');
  let offset=32;
  const b=bCurves.map(x=>x);const bOffset=offset;for(const x of b)offset+=x.length;
  let clut=null,clutOffset=0;
  if(grid!==null){clut=writeClut(grid,clutValues);clutOffset=offset;offset+=clut.length;}
  let a=null,aOffset=0;
  if(aCurves){a=aCurves.map(x=>x);aOffset=offset;for(const x of a)offset+=x.length;}
  let matrixBytes=null,matrixOffset=0;
  if(matrix){matrixBytes=writeMatrix(matrix);matrixOffset=offset;offset+=matrixBytes.length;}
  let m=null,mOffset=0;
  if(mCurves){m=mCurves.map(x=>x);mOffset=offset;for(const x of m)offset+=x.length;}
  return concat([
    four(type),new Uint8Array(4),Uint8Array.of(3,3),u16(0),
    u32(bOffset),u32(matrixOffset),u32(mOffset),u32(clutOffset),u32(aOffset),
    ...b,
    ...(clut?[clut]:[]),
    ...(a??[]),
    ...(matrixBytes?[matrixBytes]:[]),
    ...(m??[]),
  ]);
}

function pqEotf(code){
  const m1=2610/16384,m2=2523/32,c1=3424/4096,c2=2413/128,c3=2392/128;
  const p=Math.max(0,Math.min(1,code))**(1/m2);
  return Math.max((p-c1)/(c2-c3*p),0)**(1/m1); // fraction of 10,000 nits
}
function toneGain(x){return (1+TONE_A*x)/(1+x);}
function toneInverse(y){
  const b=1-y,c=-y,disc=b*b-4*TONE_A*c;
  return disc<0?0:(-b+Math.sqrt(disc))/(2*TONE_A);
}
function pqToneInput(code){
  const nits=Math.min(1000,10000*pqEotf(code));
  return nits/203;
}
function makeInputCurve(){
  const values=[];
  for(let i=0;i<65;i++){
    let x=pqToneInput(i/64);x*=toneGain(x);
    values.push(unit16(x,ONE_CURVE));
  }
  return tableCurve(values);
}
function makeClut(){
  const grid=11,values=[];
  for(let r=0;r<grid;r++)for(let g=0;g<grid;g++)for(let b=0;b<grid;b++){
    const rgb=[r/(grid-1),g/(grid-1),b/(grid-1)].map(toneInverse);
    const max=Math.max(...rgb);
    for(let c=0;c<3;c++){
      const mapped=Math.min(1,rgb[c]*toneGain(.5*(rgb[c]+max)));
      values.push(unit16(mapped,ONE_XYZ));
    }
  }
  return {grid,values};
}
function writeCicp(){return concat([four('cicp'),new Uint8Array(4),Uint8Array.of(12,16,0,1)]);}

function header(size,tagCount){
  const out=new Uint8Array(132),v=new DataView(out.buffer);
  v.setUint32(0,size);                         // profile size
  v.setUint32(8,0x04400000);                  // ICC v4.4
  out.set(four('mntr'),12);                    // display profile
  out.set(four('RGB '),16);out.set(four('XYZ '),20);
  v.setUint16(24,2016);v.setUint16(26,1);v.setUint16(28,1);
  out.set(four('acsp'),36);
  v.setUint32(64,1);                           // relative colorimetric
  out.set(fixed(D50[0]),68);out.set(fixed(D50[1]),72);out.set(fixed(D50[2]),76);
  v.setUint32(128,tagCount);
  return out;
}

export function buildDisplayP3PqHagcIcc(hagcPayload,{description='Display P3 Gamut with PQ Transfer',copyright='Stylio'}={}){
  if(!(hagcPayload instanceof Uint8Array)||!hagcPayload.length)throw new Error('HAGC payload required');
  const linear=identityCurve(),input=makeInputCurve(),{grid,values}=makeClut();
  const a2b=writeMab('mAB ',{
    bCurves:[linear,linear,linear],
    aCurves:[input,input,input],
    grid,clutValues:values,
    mCurves:[linear,linear,linear],
    matrix:P3_TO_XYZ_D50,
  });
  const b2a=writeMab('mBA ',{bCurves:[linear,linear,linear]});
  const tags=[
    ['desc',writeMluc(description)],
    ['rXYZ',writeXyz(P3_TO_XYZ_D50[0][0],P3_TO_XYZ_D50[1][0],P3_TO_XYZ_D50[2][0])],
    ['gXYZ',writeXyz(P3_TO_XYZ_D50[0][1],P3_TO_XYZ_D50[1][1],P3_TO_XYZ_D50[2][1])],
    ['bXYZ',writeXyz(P3_TO_XYZ_D50[0][2],P3_TO_XYZ_D50[1][2],P3_TO_XYZ_D50[2][2])],
    ['wtpt',writeXyz(...D50)],
    ['cicp',writeCicp()],
    ['HAGC',pad4(buildHagcIccTag(hagcPayload))],
    ['A2B0',a2b],
    ['B2A0',b2a],
    ['cprt',writeMluc(copyright)],
  ];
  const tableBytes=tags.length*12;
  let cursor=132+tableBytes;
  const table=[];
  for(const [sig,data] of tags){table.push(four(sig),u32(cursor),u32(data.length));cursor+=data.length;}
  const out=concat([header(cursor,tags.length),...table,...tags.map(x=>x[1])]);
  if(out.length!==cursor)throw new Error('ICC assembly size mismatch');
  return out;
}

export function inspectGeneratedPqIcc(profile){
  if(!(profile instanceof Uint8Array)||profile.length<132)throw new Error('Invalid ICC');
  const v=new DataView(profile.buffer,profile.byteOffset,profile.byteLength);
  if(v.getUint32(0)!==profile.length||String.fromCharCode(...profile.slice(36,40))!=='acsp')
    throw new Error('Invalid ICC header');
  const count=v.getUint32(128),tags=[];
  for(let i=0;i<count;i++){
    const p=132+i*12,sig=String.fromCharCode(...profile.slice(p,p+4)),off=v.getUint32(p+4),size=v.getUint32(p+8);
    if(off+size>profile.length)throw new Error('ICC tag outside profile');
    tags.push({sig,off,size});
  }
  return {version:v.getUint32(8),count,tags};
}
