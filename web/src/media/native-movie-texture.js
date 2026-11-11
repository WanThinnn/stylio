// Adapted from Shalielie LivePhotoVideo.swift (MIT, nathanatgit).
// Add only Texture metadata to a MOV that already has native Style tracks.
import {be,box,boxes,concat,fourcc,u} from '../core/box.js';

const TAG='com.apple.quicktime.texturestyle-info';
const PREFIX='com.apple.quicktime.texturestyle.';
const decoder=new TextDecoder();
const four=value=>be(value,4);
const full=(type,...parts)=>box(type,concat([four(0),...parts]));
const raw=(data,b)=>data.subarray(b.off,b.off+b.size);
const start=b=>b.off+b.hdr;
const end=b=>b.off+b.size;

function require(condition,message='Unexpected Live Photo movie layout') {
  if(!condition)throw Error(message);
}

function children(data,from,to) {
  const list=[...boxes(data,from,to)];
  require((list.length?end(list.at(-1)):from)===to);
  return list;
}

function inside(data,b) {return children(data,start(b),end(b));}

function find(list,type) {
  const child=list.find(b=>b.type===type);
  require(child,`Missing MOV ${type} box`);
  return child;
}

function path(data,b,...types) {
  return types.reduce((parent,type)=>find(inside(data,parent),type),b);
}

function read(data,b,offset,width=4) {
  require(offset>=0&&start(b)+offset+width<=end(b));
  const value=u(data,start(b)+offset,width);
  require(Number.isSafeInteger(value));
  return value;
}

function trackHeader(data,b) {
  const version=read(data,b,0,1);
  require(version===0||version===1);
  const offset=version===1?20:12,width=version===1?8:4;
  return {id:read(data,b,offset),duration:read(data,b,offset+8,width),offset,width};
}

function readTiming(data,track) {
  const table=path(data,track,'mdia','minf','stbl','stts');
  const entries=read(data,table,4);
  require(start(table)+8+8*entries===end(table));
  let count=0;
  for(let i=0;i<entries;i++)count+=read(data,table,8+8*i);
  require(count>0&&count<=10_000,'Unexpected Live Photo frame count');
  return {count,table:raw(data,table)};
}

function donorSamples(data,track,media) {
  const table=inside(data,path(data,track,'mdia','minf','stbl'));
  const sizes=find(table,'stsz'),runs=find(table,'stsc'),offsets=find(table,'stco');
  const count=read(data,sizes,8);
  require(count>0&&count<=10_000&&read(data,sizes,4)===0);
  require(read(data,runs,4)===1&&read(data,runs,8)===1&&read(data,runs,12)===count&&read(data,runs,16)===1);
  require(read(data,offsets,4)===1);
  let cursor=read(data,offsets,8);
  return Array.from({length:count},(_,index)=>{
    const size=read(data,sizes,12+4*index);
    require(size>0&&cursor>=start(media)&&cursor+size<=end(media));
    const sample=data.subarray(cursor,cursor+size);
    cursor+=size;
    return sample;
  });
}

function movieMetadata(data,meta) {
  const prefix=read(data,meta,0)===0?4:0;
  const list=children(data,start(meta)+prefix,end(meta));
  const keyBox=find(list,'keys'),items=find(list,'ilst');
  const count=read(data,keyBox,4),keys=[];
  let offset=8;
  for(let i=0;i<count;i++) {
    const size=read(data,keyBox,offset);
    require(size>=8&&start(keyBox)+offset+size<=end(keyBox));
    keys.push(data.subarray(start(keyBox)+offset,start(keyBox)+offset+size));
    offset+=size;
  }
  require(start(keyBox)+offset===end(keyBox));
  return {list,keys,items:inside(data,items),prefix};
}

function mergeMetadata(target,meta,donor,donorMeta) {
  const original=movieMetadata(target,meta),source=movieMetadata(donor,donorMeta);
  const names=new Set(original.keys.map(key=>decoder.decode(key.subarray(8))));
  const keys=[...original.keys],items=original.items.map(item=>raw(target,item));
  for(const item of source.items) {
    const key=source.keys[u(donor,item.off+4,4)-1];
    require(key);
    const name=decoder.decode(key.subarray(8));
    if(!name.startsWith(PREFIX)||names.has(name))continue;
    keys.push(key);names.add(name);
    items.push(concat([four(8+end(item)-start(item)),four(keys.length),donor.subarray(start(item),end(item))]));
  }
  require([...names].some(name=>name.startsWith(PREFIX)));
  const list=original.list.map(b=>{
    if(b.type==='keys')return full('keys',four(keys.length),...keys);
    if(b.type==='ilst')return box('ilst',concat(items));
    return raw(target,b);
  });
  return box('meta',concat([target.subarray(start(meta),start(meta)+original.prefix),...list]));
}

export function addMovieTexture(target,donor) {
  const top=children(target,0,target.length),moov=find(top,'moov');
  // Keeping the original mdat offsets valid requires the moov to follow them.
  require(moov===top.at(-1)&&top.some(b=>b.type==='mdat')&&!top.some(b=>b.type==='moof'));
  const movie=inside(target,moov),tracks=movie.filter(b=>b.type==='trak');
  const main=tracks.find(track=>fourcc(target,start(path(target,track,'mdia','hdlr'))+8)==='vide');
  require(main,'Missing original MOV video track');
  const mainHeader=trackHeader(target,path(target,main,'tkhd'));
  const mvhd=find(movie,'mvhd');
  const nextID=Math.max(u(target,end(mvhd)-4,4),1+Math.max(...tracks.map(track=>trackHeader(target,path(target,track,'tkhd')).id)));
  require(nextID>0&&nextID<0xffffffff);

  const donorTop=children(donor,0,donor.length),donorMovie=inside(donor,find(donorTop,'moov'));
  const donorTrack=donorMovie.find(b=>b.type==='trak'&&decoder.decode(raw(donor,b)).includes(TAG));
  require(donorTrack,'Missing Texture donor track');
  const sourceSamples=donorSamples(donor,donorTrack,find(donorTop,'mdat'));
  const timing=readTiming(target,main);
  const samples=Array.from({length:timing.count},(_,i)=>sourceSamples[Math.floor(i*sourceSamples.length/timing.count)]);
  const payload=box('mdat',concat(samples));
  const merged=mergeMetadata(target,find(movie,'meta'),donor,find(donorMovie,'meta'));
  const originalMediaHeader=raw(target,path(target,main,'mdia','mdhd'));
  const edit=inside(target,main).find(b=>b.type==='edts');

  function cloneTrack(b,offset) {
    switch(b.type) {
      case 'trak': case 'mdia': case 'minf': case 'stbl': case 'tref':
        return box(b.type,concat(inside(donor,b).map(child=>cloneTrack(child,offset))));
      case 'tkhd': {
        const header=trackHeader(donor,b),result=raw(donor,b).slice();
        require(header.width===8||mainHeader.duration<=0xffffffff);
        result.set(four(nextID),b.hdr+header.offset);
        result.set(be(mainHeader.duration,header.width),b.hdr+header.offset+8);
        return result;
      }
      case 'vmap': case 'cdsc': case 'cdep': {
        require((b.size-b.hdr)%4===0);
        return box(b.type,concat(Array((b.size-b.hdr)/4).fill(four(mainHeader.id))));
      }
      case 'edts': return edit?raw(target,edit):new Uint8Array(0);
      case 'mdhd': return originalMediaHeader;
      case 'stts': return timing.table;
      case 'stsc': return full('stsc',four(1),four(1),four(samples.length),four(1));
      case 'stsz': return full('stsz',four(0),four(samples.length),...samples.map(sample=>four(sample.length)));
      case 'stco': case 'co64': return full('stco',four(1),four(offset));
      default: return raw(donor,b);
    }
  }

  const movieHeader=raw(target,mvhd).slice();
  movieHeader.set(four(nextID+1),movieHeader.length-4);
  const originalBoxes=movie.map(b=>b.type==='mvhd'?movieHeader:b.type==='meta'?merged:raw(target,b));
  const measured=box('moov',concat([...originalBoxes,cloneTrack(donorTrack,0)]));
  const offset=moov.off+measured.length+8;
  require(offset+payload.length<=0xffffffff);
  const updated=box('moov',concat([...originalBoxes,cloneTrack(donorTrack,offset)]));
  require(updated.length===measured.length);
  return concat([target.subarray(0,moov.off),updated,payload]);
}
