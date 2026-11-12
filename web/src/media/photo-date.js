import {discoverHeic, extractItem} from '../core/heif.js';

/** Read camera dates without interpreting an unspecified camera timezone as UTC. */
export function exifDateFields(payload) {
  if (!payload || payload.length < 12) return {};
  const start = new DataView(payload.buffer,payload.byteOffset,payload.byteLength).getUint32(0)+4;
  const tiff = payload.subarray(start);
  const order = String.fromCharCode(...tiff.subarray(0,2));
  if (!['II','MM'].includes(order) || tiff.length < 8) return {};
  const view = new DataView(tiff.buffer,tiff.byteOffset,tiff.byteLength), le = order === 'II';
  const u16 = p => view.getUint16(p,le), u32 = p => view.getUint32(p,le);
  try {
    if(u16(2)!==42) return {};
    function ifd(offset) {
      if(offset<8 || offset+2>tiff.length) throw Error('Invalid date IFD');
      const count=u16(offset), entries=new Map();
      if(offset+2+count*12+4>tiff.length) throw Error('Truncated date IFD');
      for(let i=0;i<count;i++) {const p=offset+2+i*12;entries.set(u16(p),p);}
      return entries;
    }
    function ascii(entries,tag) {
      const p=entries.get(tag); if(p===undefined||u16(p+2)!==2) return undefined;
      const size=u32(p+4), offset=size<=4?p+8:u32(p+8);
      if(size<1||size>128||offset+size>tiff.length) return undefined;
      return new TextDecoder().decode(tiff.subarray(offset,offset+size)).replace(/\0.*$/s,'');
    }
    const root=ifd(u32(4)), ptr=root.get(0x8769);
    const exif=ptr!==undefined&&u16(ptr+2)===4&&u32(ptr+4)===1 ? ifd(u32(ptr+8)) : new Map();
    return Object.fromEntries(Object.entries({
      original:ascii(exif,0x9003), digitized:ascii(exif,0x9004), modified:ascii(root,0x0132),
      offsetOriginal:ascii(exif,0x9011), offsetDigitized:ascii(exif,0x9012), offset:ascii(exif,0x9010),
      subsecOriginal:ascii(exif,0x9291), subsecDigitized:ascii(exif,0x9292), subsec:ascii(exif,0x9290),
    }).filter(([,value])=>value!==undefined));
  } catch {return {};}
}

export function photoCaptureDate(bytes) {
  const d=discoverHeic(bytes);
  if(d.exifItem===null) return null;
  return captureDateFromExif(extractItem(bytes,d.iloc,d.exifItem));
}

export function captureDateFromExif(exif) {
  const fields=exifDateFields(exif);
  const date=fields.original || fields.digitized;
  if(!date || !/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) return null;
  const original=!!fields.original;
  const offset=original?fields.offsetOriginal:fields.offsetDigitized;
  const subsec=original?fields.subsecOriginal:fields.subsecDigitized;
  const iso=date.replace(/^(\d{4}):(\d{2}):(\d{2}) /,'$1-$2-$3T');
  const fraction=/^\d+$/.test(subsec||'')?'.'+subsec.slice(0,3).padEnd(3,'0'):'';
  const timestamp=/^[+-]\d{2}:\d{2}$/.test(offset||'')?Date.parse(iso+fraction+offset):undefined;
  return {date,offset,subsec,timestamp:Number.isFinite(timestamp)?timestamp:undefined};
}
