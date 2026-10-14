import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { createGzip } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const mib = Number(process.argv[2] ?? 16);
const stressEvents = Number(process.argv[3] ?? 100000);
const evidenceStage = process.argv[4] ?? 'stage-2';
if (!['stage-2', 'stage-3'].includes(evidenceStage)) throw new Error('Invalid evidence stage');
const evidenceName = process.argv[5] ?? 'benchmarks.json';
if (!/^[a-z0-9-]+\.json$/.test(evidenceName)) throw new Error('Invalid evidence filename');
if (!Number.isInteger(mib) || mib < 1 || mib > 1024 || !Number.isInteger(stressEvents) || stressEvents < 10001 || stressEvents > 1000000) throw new Error('Use MiB 1..1024 and stress records 10001..1000000');
const directory = await mkdtemp(path.join(os.tmpdir(), 'loglens-bench-'));
const levels = ['trace','debug','info','warn','error','fatal','unknown'];
let seed = 0x10_13_2026;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
const templates = Array.from({length:32}, () => Array.from({length:350}, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[random()%36]).join(''));
const expected = {};
const datasets = [];
async function generate(name, kind) {
  const file = path.join(directory,name); const output=createWriteStream(file,{flags:'wx'}); const hash=createHash('sha256');
  let bytes=0;let events=0;const severity=Object.fromEntries(levels.map(x=>[x,0]));
  try {
    while(kind==='stress' ? events<stressEvents : bytes<mib*1024**2) {
      const level=kind==='stress'?'error':levels[events%7]; const time=events%86400*1000; const message=kind==='stress'?`FailureError: distinct ${events}`:`FailureError: operation ${events%32}`;
      let record;
      if(kind==='text') {
        const content=`${new Date(time).toISOString()} ${level==='unknown'?'[unknown]':level.toUpperCase()} ${message} ${templates[events%32]} ${'x'.repeat(550)}`;
        record=content+'\n'+(events%10===0?'  at work (app.js:123:4)\n':'');
      } else {
        const object={time,level,message,service:'benchmark',logger:'worker',requestId:kind==='stress'?`r${events}`:`r${events%256}`,traceId:`t${events%64}`,spanId:`s${events%128}`,noise:templates[events%32]};
        const base=JSON.stringify(object); record=base.slice(0,-1)+',"padding":"'+'x'.repeat(Math.max(0,1024-Buffer.byteLength(base)-14))+'"}\n';
      }
      const chunk=Buffer.from(record);hash.update(chunk);bytes+=chunk.length;events++;severity[level]++;
      if(!output.write(chunk)) await once(output,'drain');
    }
    await new Promise((resolve,reject)=>{output.end(resolve);output.once('error',reject);});
  } catch(error) {output.destroy();throw error;}
  const meta={name,kind,bytes,events,severity,sha256:hash.digest('hex')};datasets.push(meta);expected[name]=meta;return file;
}
async function hashFile(file){const h=createHash('sha256');let bytes=0;for await(const c of createReadStream(file)){h.update(c);bytes+=c.length;}return {sha256:h.digest('hex'),bytes};}
const measurements=[];
try {
  const normal=await generate('normal.jsonl','jsonl'); const text=await generate('traces.log','text');const stress=await generate('cardinality.jsonl','stress');
  const compressed=path.join(directory,'normal.gz');await pipeline(createReadStream(normal),createGzip({level:6}),createWriteStream(compressed,{flags:'wx'}));
  const gzipMeta=await hashFile(compressed);datasets.push({name:'normal.gz',...gzipMeta,decompressedBytes:expected['normal.jsonl'].bytes,ratio:expected['normal.jsonl'].bytes/gzipMeta.bytes});
  const workloads=[['inspect-jsonl',['inspect',normal],'normal.jsonl'],['group-text',['group',text],'traces.log'],['report-text',['report',text],'traces.log'],['inspect-gzip',['inspect',compressed],'normal.jsonl'],['search-jsonl',['search',normal,'--query=FailureError','--limit=100'],'normal.jsonl'],['group-cardinality',['group',stress],'cardinality.jsonl']];
  for(const [name,args,dataset] of workloads){
    for(let run=0;run<6;run++){
      const output=path.join(directory,`${name}-${run}.json`);const metrics=path.join(directory,`${name}-${run}.metrics`);
      const argv=[...args,'--output-format=json','--output',output];const started=process.hrtime.bigint();
      const child=spawn(process.execPath,[path.join(root,'benchmarks/measure.mjs'),metrics,path.join(root,'dist/bin.js'),...argv],{stdio:['ignore','pipe','pipe']});
      let stderr='';let stdout='';child.stderr.on('data',c=>{stderr+=c.toString();});child.stdout.on('data',c=>{stdout+=c.toString();});
      const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});const seconds=Number(process.hrtime.bigint()-started)/1e9;
      const result=JSON.parse(await readFile(output,'utf8'));const memory=JSON.parse(await readFile(metrics,'utf8'));const oracle=expected[dataset];
      if(result.stats.eventsRead!==oracle.events||result.stats.bytesRead!==oracle.bytes||JSON.stringify(Object.entries(result.summary.severity).sort())!==JSON.stringify(Object.entries(oracle.severity).sort()))throw new Error(`Incorrect benchmark counters: ${name}`);
      const saturated=name==='group-cardinality';if(status!==(saturated?3:0)||stdout||result.coverage!==(saturated?'partial':'complete'))throw new Error(`Incorrect status: ${name}`);
      if(stderr.trim().split('\n').filter(Boolean).some(line=>!['UNKNOWN_SEVERITY','AGGREGATION_LIMIT'].includes(JSON.parse(line).code)))throw new Error('Unexpected benchmark diagnostic');
      if(saturated&&(result.analysis.overflowGroupEvents!==Math.max(0,stressEvents-10000)||!result.issues.includes('AGGREGATION_LIMIT')))throw new Error('Incorrect cardinality overflow');
      const outputMeta=await hashFile(output);
      const row={name,run,warmup:run===0,seconds,throughputMiBPerSecond:oracle.bytes/1024**2/seconds,peakRssMiB:memory.maxRssKiB/1024,status,events:result.stats.eventsRead,bytes:result.stats.bytesRead,overflowGroupEvents:result.analysis.overflowGroupEvents,resultSha256:outputMeta.sha256,outputBytes:outputMeta.bytes};measurements.push(row);
      process.stdout.write(JSON.stringify(row)+'\n');await rm(output);await rm(metrics);
    }
  }
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const summaries=workloads.map(([name])=>{const rows=measurements.filter(x=>x.name===name&&!x.warmup);if(new Set(rows.map(x=>x.resultSha256)).size!==1)throw new Error('Nondeterministic benchmark output');return {name,medianSeconds:median(rows.map(x=>x.seconds)),medianMiBPerSecond:median(rows.map(x=>x.throughputMiBPerSecond)),maxPeakRssMiB:Math.max(...rows.map(x=>x.peakRssMiB)),runs:rows.length};});
  const evidence={recordedDate:new Date().toISOString().slice(0,10),node:process.version,platform:process.platform,arch:process.arch,os:os.release(),cpu:os.cpus()[0]?.model??null,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem(),storage:'local C: filesystem; SSD type not independently verified',condition:'warm filesystem cache; one warm-up then five sequential measured subprocesses; shared desktop, no dedicated cores',seed:'0x10132026',configuration:{mib,stressEvents,outputFormat:'json',top:20,searchLimit:100,limits:'docs/PERFORMANCE_SPEC.md'},memoryMethod:'OS peak resident working set via Node/libuv process.resourceUsage().maxRSS; includes CLI runtime and measurement wrapper, no child processes in CLI',datasets,measurements,summaries,referenceTargets:'NOT TESTED: Ubuntu reference environment and mandatory 1/5 GiB workloads were not executed by this Windows smoke run'};
  const destination=path.join(process.env.LOGLENS_EVIDENCE_DIR??path.join(root,'evidence',evidenceStage),evidenceName);await writeFile(destination,JSON.stringify(evidence,null,2)+'\n');process.stdout.write(JSON.stringify({evidence:destination,summaries})+'\n');
} finally {
  const resolved=path.resolve(directory);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(resolved).startsWith('loglens-bench-'))throw new Error('Unsafe cleanup');await rm(resolved,{recursive:true,force:true});
}
