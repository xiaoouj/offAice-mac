import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {copyProductionDependencies} from './runtime-dependencies.mjs';
import {execFileSync} from 'node:child_process';

export default async function afterPack(context){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const output=path.resolve(context.appOutDir);
  if(context.electronPlatformName!=='darwin'||output!==path.join(root,'release-mac/mac-arm64'))throw Error('Unexpected Mac packaging target');
  const contents=path.join(output,'AIROOM Mac Beta.app/Contents');
  const appRoot=path.join(contents,'Resources/app');
  await rm(path.join(contents,'Resources/default_app.asar'),{force:true});
  await rm(path.join(appRoot,'node_modules'),{recursive:true,force:true});
  const dependencies=await copyProductionDependencies(appRoot,'darwin','arm64');
  const provenance=JSON.parse(await readFile(path.join(root,'UPSTREAM.json'),'utf8'));
  const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
  let sourceCommit,sourceDirty=true;
  try{
    sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    sourceDirty=!!execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'}).trim();
  }catch{/* Source archives retain explicit unknown provenance. */}
  await writeFile(path.join(contents,'Resources/build-manifest.json'),JSON.stringify({builtAt:new Date().toISOString(),sourceCommit:sourceCommit??null,upstreamCommit:provenance.commit,sourceDirty,version,platform:'darwin',arch:'arm64',dependencies,nodeVersion:'26.6.0',nodeArchiveSha256:provenance.nodeArchiveSha256},null,2));
}
