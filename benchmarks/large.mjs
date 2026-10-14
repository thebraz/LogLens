import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const directory=await mkdtemp(path.join(os.tmpdir(),'loglens-large-'));
const evidenceStage = process.argv[2] ?? 'stage-2';
assert.ok(['stage-2', 'stage-3'].includes(evidenceStage));
const evidenceName = process.argv[3] ?? 'large-stream';
assert.match(evidenceName, /^[a-z0-9-]+$/);
try{
  const size=5*1024**3;const base=JSON.stringify({time:0,level:'info',message:'repeated',padding:''});
  const record=base.slice(0,-2)+'x'.repeat(1024-Buffer.byteLength(base)-1)+'"}\n';
  assert.equal(Buffer.byteLength(record),1024);const block=Buffer.from(record.repeat(64));
  const output=path.join(directory,'result.json');const metrics=path.join(directory,'metrics.json');
  const argv=['inspect','-','--output-format=json','--output',output];
  const child=spawn(process.execPath,[path.join(root,'benchmarks/measure.mjs'),metrics,path.join(root,'dist/bin.js'),...argv],{stdio:['pipe','pipe','pipe']});
  let stdout='';let stderr='';child.stdout.on('data',c=>{stdout+=c.toString();});child.stderr.on('data',c=>{stderr+=c.toString();});
  const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  const hash=createHash('sha256');const start=process.hrtime.bigint();
  for(let bytes=0;bytes<size;bytes+=block.length){hash.update(block);if(!child.stdin.write(block))await once(child.stdin,'drain');}
  child.stdin.end();const status=await completion;const seconds=Number(process.hrtime.bigint()-start)/1e9;
  assert.equal(status,0);assert.equal(stdout+stderr,'');const resultText=await readFile(output,'utf8');const result=JSON.parse(resultText);const memory=JSON.parse(await readFile(metrics,'utf8'));
  assert.equal(result.coverage,'complete');assert.equal(result.stats.bytesRead,size);assert.equal(result.stats.eventsRead,5242880);assert.equal(result.stats.physicalLines,5242880);assert.equal(result.stats.damagedEvents,0);assert.equal(result.summary.severity.info,5242880);assert.equal(result.summary.timedEvents,5242880);assert.equal(result.summary.untimedEvents,0);
  const evidence={status:'PASS',node:process.version,platform:process.platform,arch:process.arch,workload:'5 GiB repeated JSONL, exactly 1 KiB per event, stdin streaming',bytes:size,events:5242880,recordSha256:createHash('sha256').update(record).digest('hex'),datasetSha256:hash.digest('hex'),argv,seconds,throughputMiBPerSecond:size/1024**2/seconds,cliPeakRssMiB:memory.maxRssKiB/1024,driverPeakRssMiB:process.resourceUsage().maxRSS/1024,memoryMethod:'OS peak RSS from Node/libuv for CLI subprocess and separate bounded dataset driver; no input file retained',resultSha256:createHash('sha256').update(resultText).digest('hex'),configuration:{blockBytes:block.length,recordBytes:1024,normalCliLimits:true},limitations:'One correctness/memory run on shared Windows desktop, not five-run reference performance acceptance; repeated JSONL is simpler than diverse normal data'};
  await writeFile(path.join(root,'evidence',evidenceStage,evidenceName+'.json'),JSON.stringify(evidence,null,2)+'\n');await writeFile(path.join(root,'evidence',evidenceStage,evidenceName+'.stdout.txt'),resultText);process.stdout.write(JSON.stringify(evidence)+'\n');
}finally{const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('loglens-large-'));await rm(resolved,{recursive:true,force:true});}
