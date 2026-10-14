import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));const bin=path.join(root,'dist/bin.js');
const evidenceStage=process.argv[2]??'stage-2';assert.ok(['stage-2','stage-3'].includes(evidenceStage));const evidence=process.env.LOGLENS_EVIDENCE_DIR??path.join(root,'evidence',evidenceStage);await mkdir(evidence,{recursive:true});
// AJV is already pinned in ESLint's development-only dependency tree; no runtime dependency.
const require=createRequire(import.meta.url);const Ajv=require('ajv');const ajv=new Ajv({allErrors:true});
const schema=JSON.parse((await readFile(path.join(root,'schemas/loglens.output.v1.schema.json'),'utf8')).replace(/^\uFEFF/,''));const validate=ajv.compile(schema);
const directory=await mkdtemp(path.join(os.tmpdir(),'loglens-smoke-'));const records=[];
const fixture=path.join(root,'tests/fixtures/diagnostic.jsonl');const input=await readFile(fixture);
const sha=text=>createHash('sha256').update(text).digest('hex');
function run(name,args,stdin='',expected=3,machine=true){
  const result=spawnSync(process.execPath,[bin,...args],{input:stdin,encoding:'utf8',cwd:directory,timeout:30000,maxBuffer:40*1024**2});if(result.error)throw result.error;
  assert.equal(result.status,expected,name);let output=null;
  if(machine){output=JSON.parse(result.stdout);assert.ok(validate(output),`${name}: ${JSON.stringify(validate.errors)}`);assert.equal(Object.values(output.summary.severity).reduce((a,b)=>a+b,0),output.stats.selectedEvents);assert.equal(output.summary.timedEvents+output.summary.untimedEvents,output.stats.selectedEvents);}
  records.push({name,args,expectedStatus:expected,actualStatus:result.status,status:'PASS',stdoutSha256:sha(result.stdout),stderrSha256:sha(result.stderr)});
  return {result,output};
}
try{
  const compressed=path.join(directory,'diagnostic.gz');await writeFile(compressed,gzipSync(input));const copy=path.join(directory,'second.jsonl');await writeFile(copy,input);
  const inspect=run('inspect',['inspect',fixture,'--output-format=json']);assert.equal(inspect.output.stats.eventsRead,10);assert.equal(inspect.output.stats.damagedEvents,2);assert.equal(inspect.output.summary.timedEvents,6);assert.equal(inspect.output.summary.untimedEvents,4);
  const search=run('known-error',['search',fixture,'--query=failed account 123','--output-format=json']);assert.equal(search.output.stats.matchedEvents,4);
  const filtered=run('severity-time',['search',fixture,'--query=failed','--level=error','--since=1970-01-01T00:00:01Z','--until=1970-01-01T00:00:04Z','--output-format=json']);assert.equal(filtered.output.stats.matchedEvents,2);assert.equal(filtered.output.stats.timeExcludedMissing,4);
  const group=run('repeated-distinct-groups',['group',fixture,'--output-format=json']);assert.deepEqual(group.output.groups.map(x=>x.count),[3,1,1,1]);assert.equal(group.output.groups.filter(g=>g.representative.message.includes('456')).length,1);
  const correlation=run('request-correlation',['group',fixture,'--by=request-id','--output-format=json']);assert.equal(correlation.output.groups[0].count,4);assert.equal(correlation.output.analysis.uncorrelatedEvents,6);
  const severity=run('severity-groups',['group',fixture,'--by=severity','--output-format=json']);assert.equal(severity.output.groups.find(g=>g.key==='severity:error').count,5);
  const sources=run('source-groups',['group',fixture,copy,'--by=source','--output-format=json']);assert.deepEqual(sources.output.groups.map(g=>g.count),[10,10]);
  const multi=run('multiple-inputs',['inspect',fixture,copy,'--output-format=json']);assert.equal(multi.output.stats.eventsRead,20);assert.equal(multi.output.stats.damagedEvents,4);
  const stdin=run('stdin',['inspect','-','--output-format=json'],input);assert.deepEqual(stdin.output.stats,inspect.output.stats);
  const gzip=run('gzip',['inspect',compressed,'--output-format=json']);assert.deepEqual(gzip.output.stats,inspect.output.stats);
  const report=run('json-report',['report',fixture,'--output-format=json']);assert.deepEqual(report.output.stats,inspect.output.stats);assert.equal(report.output.timeline[0].count,6);
  const html=run('html-report',['report',fixture,'--output-format=html'],'',3,false);assert.ok(html.result.stdout.includes('LogLens report'));assert.ok(html.result.stdout.includes('failed account 456'));assert.ok(!html.result.stdout.includes('<script'));
  run('clean-no-match',['search','-','--query=absent','--output-format=json'],'INFO safe\n',1);
  const hostile='{"level":"error","message":"password=CANARY_SECRET </pre><script>evil()</script> ```"}\n';
  const protectedReport=run('protected-hostile-html',['report','-','--output-format=html'],hostile,0,false);assert.ok(!protectedReport.result.stdout.includes('CANARY_SECRET'));assert.ok(!protectedReport.result.stdout.includes('<script>'));assert.ok(protectedReport.result.stdout.includes('&lt;script&gt;'));
  const second=run('repeat-determinism',['report',fixture,'--output-format=json']);assert.equal(second.result.stdout,report.result.stdout);
  const localized=spawnSync(process.execPath,[bin,'report',fixture,'--output-format=json'],{encoding:'utf8',cwd:directory,env:{...process.env,TZ:'Pacific/Honolulu',LANG:'pt_BR.UTF-8'}});assert.equal(localized.status,3);assert.equal(localized.stdout,report.result.stdout);
  records.push({name:'locale-timezone-determinism',status:'PASS',expectedStatus:3,actualStatus:localized.status});
  for(const [name,value] of [['inspect',inspect],['search',search],['group',group],['report',report],['hostile-html',protectedReport]]){await writeFile(path.join(evidence,`${name}.stdout.txt`),value.result.stdout);await writeFile(path.join(evidence,`${name}.stderr.txt`),value.result.stderr);}
  await writeFile(path.join(evidence,'report.html'),html.result.stdout);
  await writeFile(path.join(evidence,'cli-checks.json'),JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,fixtureSha256:sha(input),schemaValidator:{tool:'ajv',version:require('ajv/package.json').version,scope:'existing development tooling only'},records},null,2)+'\n');
  process.stdout.write(JSON.stringify({checks:records.length,status:'PASS',fixtureEvents:10,damagedEvents:2,timedEvents:6,untimedEvents:4,groupCounts:[3,1,1,1]})+'\n');
}finally{const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('loglens-smoke-'));await rm(resolved,{recursive:true,force:true});}
