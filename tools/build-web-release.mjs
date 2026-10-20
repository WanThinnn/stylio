// A static release with versioned module/CSS URLs prevents mixed CDN/browser caches.
import {cp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,relative,extname,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {syncReleaseInfo} from './sync-release-info.mjs';

export async function buildWebRelease(source,output,revision){
  if(!/^[a-f0-9]{7,40}$/.test(revision))throw Error('Provide a Git commit SHA for the release');
  source=resolve(source);output=resolve(output);
  const relativeOutput=relative(source,output);
  if(!relativeOutput||(!relativeOutput.startsWith(`..${sep}`)&&!isAbsolute(relativeOutput)))
    throw Error('Release output must be outside the source directory');
  await mkdir(output,{recursive:true});
  await cp(source,output,{recursive:true});
  if(existsSync(resolve(source,'VERSION')))await syncReleaseInfo(source,output);
  async function visit(directory){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const file=resolve(directory,entry.name),path=relative(output,file).replaceAll('\\','/');
      if(path.startsWith('vendor/'))continue; // Immutable model/runtime caches keep their keys.
      if(entry.isDirectory()){await visit(file);continue;}
      if(!['.html','.js','.css'].includes(extname(file)))continue;
      let text=await readFile(file,'utf8');
      // Include imports, dynamic imports, Workers, SW shell entries and script/link tags.
      text=text.replace(/(['"])([^'"\s?]+\.(?:js|mjs|css))\1/g,(match,quote,url)=>{
        if(/^(?:[a-z]+:|\/\/)/i.test(url)||url.includes('/vendor/'))return match;
        return `${quote}${url}?release=${revision}${quote}`;
      });
      if(path==='sw.js'){
        text=text.replace(/const CACHE_NAME = [^;]+;/,`const CACHE_NAME = CACHE_PREFIX + "release-${revision}";`);
        text=text.replace(/const RELEASE_ID = [^;]+;/,`const RELEASE_ID = "${revision}";`);
      }
      await writeFile(file,text);
    }
  }
  await visit(output);
  await writeFile(resolve(output,'release.json'),JSON.stringify({revision})+'\n');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../',import.meta.url));
  const revision=process.argv[2]||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  await buildWebRelease(resolve(root,'web'),resolve(root,'.stylio-site'),revision);
  console.log(`Static Stylio release ${revision} prepared in .stylio-site`);
}
