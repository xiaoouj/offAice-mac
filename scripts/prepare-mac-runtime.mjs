import {mkdir,copyFile,chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

if(process.platform!=='darwin'||process.arch!=='arm64'||process.versions.node!=='26.6.0')throw Error('Build Mac Beta with official Node.js 26.6.0 for darwin-arm64.');
const target=path.resolve('build/mac-node-runtime');
await mkdir(path.join(target,'bin'),{recursive:true});
await copyFile(process.execPath,path.join(target,'bin/node'));
await chmod(path.join(target,'bin/node'),0o755);
await copyFile(path.resolve(path.dirname(process.execPath),'../LICENSE'),path.join(target,'LICENSE'));
execFileSync(path.join(target,'bin/node'),['--version'],{stdio:'inherit'});
