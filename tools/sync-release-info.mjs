// web/VERSION and release_note/v<VERSION>.md are the editable sources.
// Commit generated copies for direct static development; releases regenerate them.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function syncReleaseInfo(web,output=web,{check=false}={}){
  web=resolve(web);output=resolve(output);
  const version=(await readFile(resolve(web,'VERSION'),'utf8')).trim();
  if(!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))throw Error('Invalid web/VERSION');
  const markdown=(await readFile(resolve(web,'../release_note',`v${version}.md`),'utf8')).replaceAll('\r\n','\n');
  if(!markdown.startsWith(`# Stylio v${version}\n`))throw Error('Release note heading does not match VERSION');
  const files={
    'src/app/version.js':`// Generated from web/VERSION by tools/sync-release-info.mjs.\nexport const VERSION = ${JSON.stringify(version)};\n`,
    [`release-notes/v${version}.md`]:markdown,
  };
  const sw=await readFile(resolve(web,'sw.js'),'utf8');
  if(!/"\.\/release-notes\/v[^"\s]+\.md"/.test(sw))throw Error('Missing release note offline-cache entry');
  files['sw.js']=sw.replace(/"\.\/release-notes\/v[^"\s]+\.md"/,JSON.stringify(`./release-notes/v${version}.md`));
  for(const [relative,content]of Object.entries(files)){
    const file=resolve(output,relative);
    if(check){
      let existing;try{existing=await readFile(file,'utf8');}catch{}
      if(existing!==content)throw Error(`Stale release asset: ${relative}; run node tools/sync-release-info.mjs`);
    }else{await mkdir(dirname(file),{recursive:true});await writeFile(file,content);}
  }
  return version;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../',import.meta.url));
  const version=await syncReleaseInfo(resolve(root,'web'),undefined,{check:process.argv.includes('--check')});
  console.log(`Release ${version} assets ${process.argv.includes('--check')?'verified':'synchronized'}`);
}
