import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import { parseArguments } from '../src/cli/args.js';
import { discover, runCommand } from '../src/cli/run.js';
import { frameLines } from '../src/io/framing.js';
import { parseRecords } from '../src/core/records.js';
import { createAnalysis } from '../src/core/analysis.js';
import { fingerprint, groupable } from '../src/core/fingerprint.js';
import { project, protectedValue } from '../src/output/project.js';
import { canonical } from '../src/core/json.js';
import { limits } from '../src/contracts/model.js';
import type { Parsed, Plan } from '../src/contracts/model.js';
import type { Result } from '../src/contracts/output.js';

const bin = path.resolve('dist/bin.js');
const source = { id: 's000001', label: 'test.log', kind: 'file' } as const;
let directory: string;
function plan(args: string[] = ['inspect']): Plan {
  const action = parseArguments(args, false); if (!('plan' in action)) throw new Error('Expected command'); return action.plan;
}
async function records(text: string | Buffer, format: Plan['format'] = 'auto') {
  const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text); const progress = { bytesRead: 0, physicalLines: 0 }; let blanks = 0;
  async function* chunks() { for (let n = 0; n < bytes.length; n += 4096) yield bytes.subarray(n, n + 4096); }
  const output: Parsed[] = [];
  for await (const event of parseRecords(frameLines(chunks(), progress, new AbortController().signal), source, plan(['inspect', `--format=${format}`]), () => { blanks++; })) output.push(event);
  return { output, progress, blanks };
}
function cli(args: string[], input: string | Buffer = '') {
  const result = spawnSync(process.execPath, [bin, ...args], { input, encoding: 'utf8', cwd: directory, timeout: 30000, maxBuffer: 40 * 1024 ** 2 });
  if (result.error) throw result.error; return result;
}
function assertResult(value: unknown): asserts value is Result {
  expect(value).toBeTypeOf('object'); if (!value || typeof value !== 'object') throw new Error('Invalid envelope');
  const keys = ['schemaVersion','command','coverage','redaction','issues','stats','sources','summary','events','groups','correlations','timeline','analysis'];
  expect(Object.keys(value).sort()).toEqual(keys.sort());
  expect(Reflect.get(value, 'schemaVersion')).toBe('loglens.output.v1');
  for (const key of ['events','groups','correlations','timeline','sources','issues']) expect(Array.isArray(Reflect.get(value,key))).toBe(true);
  const stats: unknown = Reflect.get(value, 'stats'); expect(stats).toBeTypeOf('object');
  if (!stats || typeof stats !== 'object') throw new Error('Invalid stats');
  for (const key of ['bytesRead','physicalLines','blankLines','eventsRead','damagedEvents','selectedEvents','timeExcludedMissing']) expect(Number.isSafeInteger(Reflect.get(stats,key))).toBe(true);
  for (const key of ['matchedEvents','emittedMatches','contextEvents']) expect(Reflect.get(stats,key) === null || Number.isSafeInteger(Reflect.get(stats,key))).toBe(true);
}
function decode(text: string): Result { const value: unknown = JSON.parse(text); assertResult(value); return value; }
const dataset = [
  { time: 0, level: 'info', message: 'start', service: 'api', requestId: 'R', traceId: 'T', spanId: 'S' },
  { time: 1000, level: 'error', message: 'TypeError: failed account 123', service: 'api', stack: '  at work (a.js:1:2)', requestId: 'R', traceId: 'T' },
  { time: 2000, level: 'warn', message: 'retry', service: 'api', requestId: 'R' },
  { time: 3000, level: 'error', message: 'TypeError: failed account 123', service: 'api', stack: '  at work (a.js:9:7)', requestId: 'R' },
  { time: 4000, level: 'fatal', message: 'TypeError: failed account 123', service: 'api', stack: '  at work (a.js:1:2)' },
  { time: 5000, level: 'error', message: 'TypeError: failed account 456', service: 'api', stack: '  at work (a.js:1:2)' },
  { level: 'error', message: 'no clock' }, { level: 'info', message: 'untimed' },
  { time: 'bad', level: 'error', message: 'TypeError: failed account 123', service: 'api', stack: '  at work (a.js:5:8)' }
].map(x => JSON.stringify(x)).join('\n') + '\n{bad\n';

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'loglens-stage2-')); });
afterEach(async () => { const resolved = path.resolve(directory); if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('loglens-stage2-')) throw new Error('Unsafe cleanup'); await rm(resolved, { recursive: true, force: true }); });

describe('multiline canonical pipeline', () => {
  it('folds Node/Python/Java evidence, preserves BOM/CRLF original-byte hash and blanks', async () => {
    const raw = '\uFEFFERROR TypeError: bad\r\n  at fn (a.js:1:2)\r\nCaused by: OtherError: why\r\n';
    const r = await records(raw + '\r\nINFO next\n');
    expect(r.output).toHaveLength(2); expect(r.blanks).toBe(1);
    expect(r.output[0]?.event).toMatchObject({ message: 'TypeError: bad\n  at fn (a.js:1:2)\nCaused by: OtherError: why', severity: 'error',
      position: { lineStart: 1, lineEnd: 3, byteStart: 0, byteEnd: Buffer.byteLength(raw) }, raw: { text: raw.slice(1,-2), complete: true, byteLength: Buffer.byteLength(raw), sha256: createHash('sha256').update(raw).digest('hex') } });
    const python = await records('ERROR python\nTraceback (most recent call last):\n  File "app.py", line 2, in main\nValueError: bad\nINFO next');
    expect(python.output.map(x => x.event.position.lineEnd)).toEqual([4,5]);
    expect((await records('ERROR java\n\tat app.run(App.java:42)\n... 3 more\n')).output).toHaveLength(1);
  });
  it('handles orphan, JSON boundary, indented headers, generic text and explicit jsonl', async () => {
    const text = '  orphan\n  second\n{"message":"json"}\n  another\n  INFO header\nplain\n';
    const r = await records(text); expect(r.output).toHaveLength(5);
    expect(r.output[0]?.codes.has('ORPHAN_CONTINUATION')).toBe(true);
    expect(r.output[2]?.codes.has('ORPHAN_CONTINUATION')).toBe(true);
    expect(r.output[3]?.event.severity).toBe('info');
    expect((await records('ERROR x\n  at a (a.js:1:2)\n', 'jsonl')).output).toHaveLength(2);
  });
  it.each([-1,0,1])('enforces multiline byte cap %+d and drains to a new header without splitting', async delta => {
    const target = limits.event + delta;
    const first = 'ERROR bad\n'; const line = '  ' + 'x'.repeat(65533) + '\n';
    let text = first; while (Buffer.byteLength(text) + Buffer.byteLength(line) + 4 < target) text += line;
    text += '  ' + 'y'.repeat(target - Buffer.byteLength(text) - 3) + '\n';
    expect(Buffer.byteLength(text)).toBe(target);
    const r = await records(text + 'INFO recovered\n'); expect(r.output).toHaveLength(2);
    const event = r.output[0]; expect(event?.event.raw.byteLength).toBe(target);
    expect(event?.codes.has('EVENT_TOO_LARGE')).toBe(delta > 0);
    expect(event?.event.raw.complete).toBe(delta <= 0);
    expect(event?.event.raw.sha256).toBe(createHash('sha256').update(text).digest('hex'));
    if (delta > 0) expect(Buffer.byteLength(event?.event.raw.text ?? '')).toBeLessThanOrEqual(limits.prefix);
    expect(r.output[1]?.event.message).toBe('recovered');
  });
});

describe('functional compiled CLI', () => {
  it('shares exact totals between inspection, groups and JSON/HTML/Markdown reports', async () => {
    const file = path.join(directory, 'fixture.jsonl'); await writeFile(file, dataset);
    const inspect = cli(['inspect',file,'--output-format=json']); expect(inspect.status).toBe(3);
    const a = decode(inspect.stdout); expect(a.stats).toMatchObject({ eventsRead: 10, selectedEvents: 10, damagedEvents: 2, physicalLines: 10 });
    expect(a.summary).toEqual({ severity: { trace:0,debug:0,info:2,warn:1,error:5,fatal:1,unknown:1 }, earliest:'1970-01-01T00:00:00.000Z',latest:'1970-01-01T00:00:05.000Z',timedEvents:6,untimedEvents:4 });
    for (const command of ['group','report']) {
      const r = cli([command,file,'--output-format=json']); expect(r.status).toBe(3); const b = decode(r.stdout);
      expect(b.stats).toEqual(a.stats); expect(b.summary).toEqual(a.summary);
      expect(b.groups.map(g => g.count).sort()).toEqual([1,1,1,3]); expect(b.groups[0]?.representative.id).toBe('s000001:e2');
      expect(b.groups.reduce((sum,g) => sum+g.count,0) + b.analysis.ungroupableEvents + b.analysis.overflowGroupEvents).toBe(6);
      if (command === 'report') { expect(b.timeline.reduce((sum,x)=>sum+x.count,0)).toBe(6); expect(b.correlations.map(g => [g.key,g.count])).toEqual([['request:g1',4],['trace:g1',2],['span:g1',1]]); }
    }
    for (const format of ['html','markdown']) { const dest = path.join(directory, `report.${format}`); const r = cli(['report',file,`--output-format=${format}`,'--output',dest]); expect(r.status).toBe(3);
      const output = await readFile(dest,'utf8'); expect(output).toContain('LogLens report'); expect(output).toContain('failed account 123'); expect(output).toContain('Untimed selected events: 4'); expect(output).toContain('not inferred causes'); }
  });
  it('filters with AND families, OR IDs/levels, UTC bounds and explicit missing-time counts', () => {
    const r = cli(['inspect','-','--level=error,fatal','--since=1970-01-01T00:00:01Z','--until=1970-01-01T00:00:04Z','--service=api','--id=request:R','--id=trace:unused','--source=s000001','--output-format=json'],dataset);
    const x = decode(r.stdout); expect(r.status).toBe(3); expect(x.stats).toMatchObject({eventsRead:10,selectedEvents:2,timeExcludedMissing:4}); expect(x.summary.severity.error).toBe(2);
    const offset = cli(['inspect','-','--since=1970-01-01T01:00:01+01:00','--until=1970-01-01T01:00:04+01:00','--level=error','--output-format=json'],dataset);
    expect(decode(offset.stdout).stats.selectedEvents).toBe(2);
  });
  it('searches literals, ASCII-only case, multiline queries, normalized message only and no matches', () => {
    const input = 'INFO a.*b Ä\nERROR MATCH\n  detail\nINFO end\n';
    const literal = cli(['search','-','--query=a.*b','--output-format=json'],input); expect(literal.status).toBe(0); expect(decode(literal.stdout).stats.matchedEvents).toBe(1);
    expect(cli(['search','-','--query=a.+b','--output-format=json'],input).status).toBe(1);
    expect(decode(cli(['search','-','--query=match\n  DETAIL','--ignore-case','--output-format=json'],input).stdout).stats.matchedEvents).toBe(1);
    expect(cli(['search','-','--query=ä','--ignore-case','--output-format=json'],input).status).toBe(1);
    expect(cli(['search','-','--query=hidden','--output-format=json'],'{"message":"safe","extra":"hidden"}\n').status).toBe(1);
  });
  it('deduplicates overlapping context, omits later matches, counts excluded intervening positions and source boundaries', async () => {
    const input = ['INFO before','ERROR hit','WARN between','ERROR hit','INFO after','ERROR hit','INFO last'].join('\n')+'\n';
    const r = cli(['search','-','--query=hit','--before=2','--after=2','--limit=2','--output-format=json'],input); const x = decode(r.stdout);
    expect(x.events.map(e => [e.id,e.match])).toEqual([['s000001:e1','context'],['s000001:e2','match'],['s000001:e3','context'],['s000001:e4','match'],['s000001:e5','context']]);
    expect(x.stats).toMatchObject({matchedEvents:3,emittedMatches:2,contextEvents:3}); expect(x.analysis.displayTruncated).toBe(true); expect(x.coverage).toBe('complete');
    const filtered = decode(cli(['search','-','--query=hit','--level=error,info','--before=1','--after=1','--limit=1','--output-format=json'],input).stdout);
    expect(filtered.events.map(e=>e.id)).toEqual(['s000001:e1','s000001:e2']);
    await writeFile(path.join(directory,'a'),'INFO before\n'); await writeFile(path.join(directory,'b'),'ERROR hit\n');
    expect(decode(cli(['search','a','b','--query=hit','--before=100','--output-format=json']).stdout).events.map(e=>e.id)).toEqual(['s000002:e1']);
  });
  it('streams valid NDJSON start/event/summary and agrees with JSON including no-match', () => {
    for (const query of ['failed','missing']) {
      const args = ['search','-','--query',query,'--before=1','--after=1'];
      const json = cli([...args,'--output-format=json'],dataset); const nd = cli([...args,'--output-format=ndjson'],dataset);
      const rows: unknown[] = nd.stdout.trim().split('\n').map((s: string) => JSON.parse(s));
      expect(nd.status).toBe(json.status); expect(rows[0]).toMatchObject({type:'start',schemaVersion:'loglens.output.v1'});
      const last = rows.at(-1); expect(last).toMatchObject({type:'summary',result:{events:[]}});
      if (!last || typeof last !== 'object') throw new Error('No summary');
      const summary: unknown = Reflect.get(last,'result'); assertResult(summary);
      const expected = decode(json.stdout); expect(summary).toEqual({...expected,events:[]});
      expect(rows.slice(1,-1).map(x => x && typeof x==='object' ? Reflect.get(x,'event') : null)).toEqual(expected.events);
    }
  });
  it('processes multiple files, normalized duplicates, partial failures and a valid empty input', async () => {
    await writeFile(path.join(directory,'one'),'INFO a\n'); await writeFile(path.join(directory,'empty'),'');
    const r = cli(['inspect','missing','one','./one','-','empty','--output-format=json'],'ERROR b\n'); const x = decode(r.stdout);
    expect(r.status).toBe(3); expect(x.sources.map(s=>[s.id,s.status,s.eventsRead])).toEqual([['s000001','failed',0],['s000002','complete',1],['s000003','complete',1],['s000004','complete',0]]);
    expect(x.stats.eventsRead).toBe(2); expect(cli(['inspect','missing','empty']).status).toBe(3); expect(cli(['inspect','missing','missing2']).status).toBe(4);
    await mkdir(path.join(directory,'sub')); await writeFile(path.join(directory,'sub','one'),'WARN c\n');
    expect(decode(cli(['inspect','one','sub/one','--source=one','--output-format=json']).stdout).stats.selectedEvents).toBe(2);
    expect(decode(cli(['inspect','one','sub/one','--source=s000002','--output-format=json']).stdout).stats.selectedEvents).toBe(1);
    expect(discover(['a','./a'], 'win32')).toHaveLength(1);
    expect(discover(['A','a'], 'win32')).toHaveLength(1); expect(discover(['A','a'],'linux')).toHaveLength(2);
  });
  it('detects gzip by magic, handles concatenation/stdin and reports CRC/trailing/extension failures', async () => {
    const plain = 'INFO a\nERROR b\n'; const gzip = gzipSync(plain); await writeFile(path.join(directory,'compressed.log'),gzip);
    const expected = decode(cli(['inspect','-','--output-format=json'],plain).stdout);
    for (const [args,input] of [[['inspect','compressed.log','--output-format=json'],''],[['inspect','-','--output-format=json'],gzip],[['inspect','-','--output-format=json'],Buffer.concat([gzipSync('INFO a\n'),gzipSync('ERROR b\n')])]] as const) {
      const r = cli([...args],input); expect(r.status).toBe(0); const x = decode(r.stdout); expect(x.stats).toEqual(expected.stats); expect(x.summary).toEqual(expected.summary);
    }
    const badCrc = Buffer.from(gzip); badCrc[badCrc.length-8] = (badCrc[badCrc.length-8] ?? 0)^255;
    for (const bad of [gzip.subarray(0,-3),badCrc,Buffer.concat([gzip,Buffer.from('junk')]),Buffer.concat([gzip,Buffer.from([0,0])])]) {
      const r = cli(['inspect','-','--output-format=json'],bad); expect([3,4]).toContain(r.status); expect(r.stderr).toContain('GZIP_INVALID');
    }
    await writeFile(path.join(directory,'false.gz'),plain); expect(cli(['inspect','false.gz']).status).toBe(4);
  });
  it('stops gzip expansion, continues later sources and never claims complete statistics', async () => {
    await writeFile(path.join(directory,'bomb.gz'),gzipSync('INFO '+ 'a'.repeat(2*1024**2)+'\n'));
    await writeFile(path.join(directory,'valid'),'INFO safe\n');
    const r = cli(['inspect','bomb.gz','valid','--output-format=json']); const x=decode(r.stdout);
    expect(r.status).toBe(3); expect(x.coverage).toBe('partial'); expect(x.sources[0]?.errors).toContain('GZIP_RATIO_LIMIT'); expect(x.sources[1]?.eventsRead).toBe(1);
  });
  it('uses exact namespaced identifiers, missing IDs and distinct public keys for redacted values', () => {
    const input = [{message:'a',requestId:'password=A',traceId:'password=A',spanId:'S'}, {message:'b',requestId:'password=A'}, {message:'c',requestId:'password=B'}, {message:'d',requestId:'Password=A'}, {message:'none'}].map(x=>JSON.stringify(x)).join('\n');
    const x=decode(cli(['group','-','--by=request-id','--output-format=json'],input).stdout);
    expect(x.groups.map(g=>g.count)).toEqual([2,1,1]); expect(new Set(x.groups.map(g=>g.key)).size).toBe(3); expect(x.analysis.uncorrelatedEvents).toBe(1);
    const report=decode(cli(['report','-','--output-format=json'],input).stdout); expect(report.correlations.reduce((s,g)=>s+g.count,0)).toBe(6); expect(report.correlations.some(g=>g.key==='trace:g1')).toBe(true);
    expect(decode(cli(['inspect','-','--id=request:password=A','--output-format=json'],input).stdout).stats.selectedEvents).toBe(2);
  });
  it('handles negative buckets, out-of-order timestamps, missing times and the year-9999 boundary', () => {
    const input = [-1,60000,0,253402300799999].map(time=>JSON.stringify({time,message:'x'})).join('\n')+'\n{"message":"untimed"}\n';
    const x=decode(cli(['report','-','--bucket=1m','--output-format=json'],input).stdout);
    expect(x.timeline.map(b=>b.count)).toEqual([1,1,1,1]); expect(x.timeline[0]?.start).toBe('1969-12-31T23:59:00.000Z'); expect(x.timeline.at(-1)?.end).toBeNull(); expect(x.summary.untimedEvents).toBe(1);
  });
  it('protects every output, raw/hash defaults, explicit opt-out, HTML and Markdown payloads', async () => {
    const input=JSON.stringify({level:'error',message:'password=CANARY_MSG </pre><script>alert(1)</script> [click](javascript:evil) ``` \x1b\u202e',requestId:'token=CANARY_ID',service:'secret=CANARY_SERVICE',stack:'Bearer CANARY_STACK',token:{deep:'CANARY_ATTR'}})+'\n';
    for (const [command,format] of [['search','json'],['search','ndjson'],['search','text'],['group','json'],['report','json'],['report','html'],['report','markdown']] as const) {
      const args=[command,'-',`--output-format=${format}`, ...(command==='search' ? ['--query=CANARY_MSG',...(format==='text'?[]:['--include-raw'])] : [])];
      const destination=path.join(directory,`${command}.${format}`); const r=cli([...args,'--output',destination],input); expect(r.status).toBe(0);
      const output=await readFile(destination,'utf8'); for (const canary of ['CANARY_MSG','CANARY_ID','CANARY_SERVICE','CANARY_STACK','CANARY_ATTR']) expect(output+r.stderr).not.toContain(canary);
      expect(output).not.toContain('\x1b'); if(format==='html') {expect(output).not.toContain('<script>');expect(output).toContain('&lt;script&gt;');expect(output).not.toMatch(/(?:src|href)=/);}
      if(format==='markdown') expect(output).toContain('````text');
    }
    const x=decode(cli(['search','-','--query=CANARY_MSG','--output-format=json','--include-raw'],input).stdout); expect(x.events[0]?.raw?.sha256).toBeNull(); expect(x.events[0]?.redaction.changed).toBe(true);
    const sensitive=cli(['search','-','--query=CANARY_MSG','--output-format=json','--include-raw','--no-redact','--ack-sensitive-output'],input); expect(sensitive.stdout).toContain('CANARY_MSG');
    expect(decode(sensitive.stdout).events[0]?.raw?.sha256).toMatch(/^[a-f0-9]{64}$/); expect(sensitive.stdout).not.toContain('\x1b');
    expect((await readdir(directory)).some(x=>x.endsWith('.tmp'))).toBe(false);
  });
  it('applies projection clipping and --top as display limits without partial coverage', () => {
    const input=[{level:'error',message:'first '+ 'x'.repeat(16000),extra:'y'.repeat(60000)},{level:'error',message:'second'}].map(x=>JSON.stringify(x)).join('\n');
    const r=cli(['group','-','--top=1','--output-format=json'],input); const x=decode(r.stdout);
    expect(r.status).toBe(0); expect(x.groups).toHaveLength(1); expect(x.analysis.displayTruncated).toBe(true);
    expect(Buffer.byteLength(canonical(x.groups[0]?.representative))).toBeLessThanOrEqual(limits.representative);
  });
});

describe('bounded aggregation, fingerprints and options', () => {
  it('normalizes only numeric frame locations, separates service/logger/severity/digits/UUID/path/exception/tail and verifies collisions', async () => {
    const base={level:'error',message:'TypeError: failed 123\n  at run (a.js:1:2)',service:'api',logger:'main'};
    const parse=async(value: object)=>{const p=(await records(JSON.stringify(value))).output[0];if(!p)throw new Error('No event');return p;};
    const original=await parse(base); const key=fingerprint(original);
    expect(fingerprint(await parse({...base,message:base.message.replace('1:2','9:8')}))).toBe(key);
    for (const value of [{...base,service:'other'},{...base,logger:'other'},{...base,level:'fatal'},{...base,message:base.message.replace('123','456')},{...base,message:base.message.replace('a.js','b.js')},{...base,message:base.message+'\nCaused by: OtherError: why'},{...base,message:base.message.replace('TypeError','RangeError')},{...base,message:base.message+'\n uuid-a'}]) expect(fingerprint(await parse(value))).not.toBe(key);
    const p=plan(['group']);const analysis=createAnalysis(p,(e,m,r)=>project(e,m,true,false,r),v=>protectedValue(v,true),undefined,()=> 'a'.repeat(64));
    const outcome={...source,status:'complete',bytesRead:0,eventsRead:0,damagedEvents:0,errors:[]} as const;
    // Each assertion uses a fresh mutable source outcome, while grouping remains shared.
    analysis.accept(original,{...outcome,errors:[]});analysis.accept(await parse({...base,message:'other'}),{...outcome,errors:[]});
    const x=analysis.finish();expect(x.groups.map(g=>g.key).sort()).toEqual(['a'.repeat(64),'a'.repeat(64)+':2']);expect(x.issues).toContain('HASH_COLLISION');expect(x.coverage).toBe('partial');
    expect(groupable(await parse({...base,time:'bad'}))).toBe(true); expect(groupable(await parse({...base,message:'x'.repeat(17000)}))).toBe(false);
  });
  it('retains admitted counts exactly after group, identifier, timeline and combined-byte saturation', async () => {
    const p=plan(['report']);const a=createAnalysis(p,(e,m,r)=>project(e,m,true,false,r),v=>v,{keys:2,bytes:64*1024**2});
    for(const [n,msg] of [[0,'one'],[1,'two'],[2,'three'],[3,'one']] as const){const parsed=(await records(JSON.stringify({time:n*3600000,level:'error',message:msg,requestId:msg,traceId:msg}))).output[0];if(!parsed)throw new Error('No record');a.accept(parsed,{...source,status:'complete',bytesRead:0,eventsRead:0,damagedEvents:0,errors:[]});}
    const x=a.finish();expect(x.coverage).toBe('partial');expect(x.stats.eventsRead).toBe(4);expect(x.groups.map(g=>g.count)).toEqual([2,1]);expect(x.analysis.overflowGroupEvents).toBe(1);expect(x.analysis.overflowCorrelationMemberships).toBe(4);expect(x.analysis.overflowTimelineEvents).toBe(2);expect(x.timeline.reduce((n,b)=>n+b.count,0)+x.analysis.overflowTimelineEvents).toBe(x.summary.timedEvents);
    const b=createAnalysis(p,(e,m,r)=>project(e,m,true,false,r),v=>v,{keys:10000,bytes:1});const parsed=(await records('{"level":"error","message":"x","requestId":"R","time":0}')).output[0];if(!parsed)throw new Error('No record');b.accept(parsed,{...source,status:'complete',bytesRead:0,eventsRead:0,damagedEvents:0,errors:[]});expect(b.retainedBytes()).toBe(0);expect(b.finish().analysis).toMatchObject({overflowGroupEvents:1,overflowCorrelationMemberships:1,overflowTimelineEvents:1});
  });
  it('enforces actual 10000-key grouping cardinality while counting later admitted occurrences', () => {
    let input='';for(let n=0;n<10001;n++)input+=JSON.stringify({level:'error',message:`failure ${n}`})+'\n';input+='{"level":"error","message":"failure 0"}\n';
    const r=cli(['group','-','--output-format=json'],input);const x=decode(r.stdout);expect(r.status).toBe(3);expect(x.groups[0]?.count).toBe(2);expect(x.analysis.overflowGroupEvents).toBe(1);expect(x.stats.eventsRead).toBe(10002);expect(x.issues).toEqual(['AGGREGATION_LIMIT']);
  },30000);
  it.each([['search','--query=x','--before=101'],['search','--query=x','--after=-1'],['search','--query=x','--limit=0'],['search','--query=x','--limit=1e2'],['group','--top=10001'],['group','--by=service'],['report','--bucket=2h'],['inspect','--level=error,'],['inspect','--since=2026-01-01'],['inspect','--since=1970-01-01T00:00:01Z','--until=1970-01-01T00:00:00Z'],['inspect','--id=correlation:x'],['inspect','--id=request:'],['inspect','--ack-sensitive-output'],['search','--query=x','--include-raw'],['inspect','-','-']])('rejects invalid V1 arguments %j',(...args)=>{expect(cli(args).status).toBe(2);});
  it('propagates slow search backpressure and cancellation without a completion footer', async () => {
    let pulled=0;let release:(()=>void)|undefined;
    async function* input(){pulled++;yield Buffer.from('{"message":"hit"}\n');pulled++;yield Buffer.from('{"message":"hit"}\n');}
    const stdout=new Writable({highWaterMark:1,write(_c,_e,callback){release=callback;}});const stderr=new Writable({write(_c,_e,callback){callback();}});const controller=new AbortController();
    const operation=runCommand(plan(['search','-','--query=hit']),{stdin:Readable.from(input(),{highWaterMark:1}),stdout,stderr,signal:controller.signal});
    const assertion=expect(operation).rejects.toMatchObject({code:'INTERRUPTED'});
    await new Promise(r=>setTimeout(r,50));expect(pulled).toBeLessThanOrEqual(2);const start=performance.now();controller.abort();await assertion;expect(performance.now()-start).toBeLessThan(2000);release?.();stdout.destroy();
  });
  it('stops at source and run byte caps before pulling further chunks',async()=>{
    async function* chunks(){yield Buffer.from('INFO x\n');throw new Error('Extra pull');}
    const iterator=frameLines(chunks(),{bytesRead:0,physicalLines:0},new AbortController().signal,{bytesRead:limits.runBytes});await expect(iterator.next()).rejects.toMatchObject({code:'RUN_BYTE_LIMIT'});
  });
});

describe('output capacity and privacy boundaries',()=>{
  it('rejects JSON search retention overflow, discards its file and recommends NDJSON',async()=>{
    const input=(JSON.stringify({message:'hit',padding:'x'.repeat(60000)})+'\n').repeat(600);
    const file=path.join(directory,'large.log');await writeFile(file,input);
    const dest=path.join(directory,'large.json');const r=cli(['search',file,'--query=hit','--limit=1000','--include-raw','--output-format=json','--output',dest]);
    expect(r.status).toBe(4);expect(r.stdout).toBe('');expect(r.stderr).toContain('OUTPUT_LIMIT');expect(r.stderr).toContain('NDJSON');expect(await readdir(directory)).toEqual(['large.log']);
  },30000);
  it('redacts provider credentials cut by message retention while preserving documented complete short misses',async()=>{
    const input=JSON.stringify({message:'x'.repeat(limits.message-7)+' sk-abcdefghijklmnopqrstuvwxyz'});
    const parsed=(await records(input)).output[0];if(!parsed)throw new Error('Missing event');
    expect(project(parsed.event,'match',true,false).message.endsWith('[REDACTED]')).toBe(true);
    const short=(await records('{"message":"sk-abc"}')).output[0];if(!short)throw new Error('Missing short');expect(project(short.event,'match',true,false).message).toBe('sk-abc');
  });
  it('retains tail-frame distinctions after the first three recognized frames',async()=>{
    const first='Error: boom\n  at a (a.js:1:2)\n  at b (b.js:1:2)\n  at c (c.js:1:2)\n  at d (d.js:1:2)';
    const a=(await records(JSON.stringify({message:first,level:'error'}))).output[0];const b=(await records(JSON.stringify({message:first.replace('d.js','e.js'),level:'error'}))).output[0];const c=(await records(JSON.stringify({message:first.replaceAll(':1:2',':8:9'),level:'error'}))).output[0];
    if(!a||!b||!c)throw new Error('Missing record');expect(fingerprint(a)).not.toBe(fingerprint(b));expect(fingerprint(a)).toBe(fingerprint(c));
  });
});

describe('authorized severity and source grouping',()=>{
  it('groups all selected severities including unknown, without inferring levels',()=>{
    const r=cli(['group','-','--by=severity','--output-format=json'],dataset);const x=decode(r.stdout);
    expect(r.status).toBe(3);expect(x.groups.map(g=>[g.key,g.count])).toEqual([['severity:error',5],['severity:info',2],['severity:fatal',1],['severity:unknown',1],['severity:warn',1]]);
    expect(x.groups.reduce((n,g)=>n+g.count,0)).toBe(10);expect(x.analysis.uncorrelatedEvents).toBe(0);expect(x.analysis.groupingMode).toBe('severity');
  });
  it('keeps basename collisions distinct by source ID and protects source values',async()=>{
    await mkdir(path.join(directory,'sub'));await writeFile(path.join(directory,'password=CANARY_SOURCE'),'INFO first\n');await writeFile(path.join(directory,'sub','password=CANARY_SOURCE'),'ERROR second\nWARN third\n');
    const r=cli(['group','password=CANARY_SOURCE','sub/password=CANARY_SOURCE','--by=source','--output-format=json']);const x=decode(r.stdout);
    expect(r.status).toBe(0);expect(x.groups.map(g=>[g.key,g.count])).toEqual([['source:s000002',2],['source:s000001',1]]);expect(x.groups.every(g=>g.value==='password=[REDACTED]')).toBe(true);expect(r.stdout+r.stderr).not.toContain('CANARY_SOURCE');
  });
});

describe('recognition boundaries',()=>{
  it('attaches indented content that resembles an incomplete header',async()=>{
    const r=await records('ERROR intact\n  [unterminated\n  2026-10-13T12:bad\nINFO next\n');
    expect(r.output).toHaveLength(2);expect(r.output[0]?.event.position.lineEnd).toBe(3);expect(r.output[0]?.event.message).toContain('[unterminated');
  });
  it('handles long dotted non-exception identifiers without repeated failed delimiter scans',async()=>{
    const event=(await records(JSON.stringify({level:'error',message:'a.'.repeat(7000)}))).output[0];if(!event)throw new Error('Missing event');expect(fingerprint(event)).toContain('loglens.fingerprint.v1');
  });
});
