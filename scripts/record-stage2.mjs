import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const files=[];
async function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await walk(file);else if(entry.isFile())files.push(file);}}
for(const directory of ['src','dist','tests','benchmarks','scripts','schemas','docs'])await walk(directory);
files.push('AGENTS.md','README.md','package.json','package-lock.json','tsconfig.json','tsconfig.build.json','eslint.config.js');
const rows=[];for(const file of files.filter(x=>!x.endsWith('STAGE_2_ACCEPTANCE.md')).sort()){const bytes=await readFile(file);rows.push({path:file.replaceAll(path.sep,'/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
const manifest=JSON.stringify({algorithm:'sha256',files:rows},null,2)+'\n';
await writeFile('evidence/stage-2/build-manifest.json',manifest);await writeFile('evidence/stage-2/build-manifest.sha256',createHash('sha256').update(manifest).digest('hex')+'\n');
await writeFile('evidence/stage-2/environment.json',JSON.stringify({node:process.version,npm:'11.17.0',os:os.release(),platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model??null,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem(),runtimeDependencies:[],publication:'NOT AUTHORIZED',stages3and4:'NOT AUTHORIZED'},null,2)+'\n');
process.stdout.write(JSON.stringify({files:rows.length,manifestSha256:createHash('sha256').update(manifest).digest('hex')})+'\n');
