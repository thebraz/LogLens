import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile, rename, unlink } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import { parseArguments } from '../src/cli/args.js';
import { frameLines } from '../src/io/framing.js';
import { readInput } from '../src/io/input.js';
import { createFileSink, writeStream } from '../src/io/sink.js';
import { parseRecords } from '../src/core/records.js';
import { redact, protectJson } from '../src/output/protect.js';
import { canonical, prefix } from '../src/core/json.js';
import { createAnalysis } from '../src/core/analysis.js';
import { fingerprint } from '../src/core/fingerprint.js';
import { project } from '../src/output/project.js';
import { renderReport, escapeHtml } from '../src/output/render.js';
import type { Parsed, Plan } from '../src/contracts/model.js';

const bin = path.resolve('dist/bin.js');
const source = { id: 's000001', label: 'audit.log', kind: 'file' } as const;
let directory: string;
const signal = () => new AbortController().signal;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'loglens-audit-')); });
afterEach(async () => {
  const target = path.resolve(directory);
  if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('loglens-audit-')) throw new Error('Unsafe cleanup');
  await rm(target, { recursive: true, force: true });
});
async function records(text: string, format: Plan['format'] = 'auto') {
  const events: Parsed[] = []; const progress = { bytesRead: 0, physicalLines: 0 };
  for await (const event of parseRecords(frameLines(Readable.from([Buffer.from(text)]), progress, signal()), source,
    { format, assumeTimezone: null }, () => undefined)) events.push(event);
  return events;
}
function cli(args: string[], input: string | Buffer) {
  const result = spawnSync(process.execPath, [bin, ...args], { input, encoding: 'utf8', cwd: directory, timeout: 5000, maxBuffer: 8 * 1024 ** 2 });
  if (result.error) throw result.error;
  return result;
}

describe('Stage 3 confirmed regression cases', () => {
  it('protects entire sensitive JSON values including escaped keys in raw exports', () => {
    const input = '{"message":"hit","to\\u006ben":["CANARY_A",{"safe":"CANARY_B"}],"password":{"a":1,"b":"CANARY_C"}}\n';
    for (const format of ['json', 'ndjson']) {
      const result = cli(['search', '-', '--query=hit', '--include-raw', `--output-format=${format}`], input);
      expect(result.status).toBe(0);
      for (const secret of ['CANARY_A', 'CANARY_B', 'CANARY_C']) expect(result.stdout + result.stderr).not.toContain(secret);
      expect(result.stdout).toContain('[REDACTED]');
    }
    const unsafe = cli(['search', '-', '--query=hit', '--include-raw', '--output-format=json', '--no-redact', '--ack-sensitive-output'], input);
    expect(unsafe.status).toBe(0); expect(unsafe.stdout).toContain('CANARY_B');
  });
  it('keeps malformed JSON fallback and incomplete raw strings protected', () => {
    for (const input of ['{"message":"hit","to\\u006ben":["CANARY_A","CANARY_B"', '{"message":"hit password=\\"CANARY_A CANARY_B']) {
      const result = cli(['search', '-', '--query=hit', '--include-raw', '--output-format=json'], input);
      expect(result.status).toBe(3); expect(result.stderr).toContain('MALFORMED_JSON');
      expect(result.stdout).not.toContain('CANARY_A'); expect(result.stdout).not.toContain('CANARY_B');
    }
  });
  it('redacts JWT segments with base64url punctuation at either endpoint', () => {
    for (const token of ['abcdefgh.ijklmnop.qrstuvw-', '-abcdefg.ijklmnop.qrstuvwx', 'abcdefgh.-jklmnop.qrstuvwx']) {
      expect(redact(token)).toBe('[REDACTED]');
    }
    expect(redact('short.middle.signature')).toBe('short.middle.signature');
  });
  it('redacts spaced sensitive keys and nested assignment values as one value', () => {
    expect(redact('api' + ' '.repeat(80) + 'key=CANARY')).not.toContain('CANARY');
    expect(redact('token=["CANARY_A", {"a":"CANARY_B"}] next')).toBe('token=[REDACTED] next');
  });
  it('bounds synchronous redaction work on failed URI/JWT candidates', () => {
    const script = `import {redact} from ${JSON.stringify(new URL('../dist/output/protect.js', import.meta.url).href)};
      for(const s of ['http://'+':'.repeat(65536), 'a-'.repeat(32768), 'a-'.repeat(32768)+'.short.x']) redact(s);
      process.stdout.write('done');`;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { timeout: 2000, encoding: 'utf8' });
    expect(child.error).toBeUndefined(); expect(child.status).toBe(0); expect(child.stdout).toBe('done');
  });
  it('resets exception-continuation evidence at JSON and blank boundaries', async () => {
    for (const boundary of ['\n', '{"message":"json"}\n']) {
      const output = await records('ERROR TypeError: old\n' + boundary + 'ValueError: separate\nINFO next\n');
      const independent = output.find(e => e.event.message === 'ValueError: separate');
      expect(independent?.damaged).toBe(false); expect(independent?.codes.has('ORPHAN_CONTINUATION')).toBe(false);
      expect(output.at(-1)?.event.position.lineStart).toBe(4);
    }
  });
  it('rejects a replaced temp file and preserves the unknown replacement on cleanup', async () => {
    const target = path.join(directory, 'result.json'); const sink = await createFileSink(target, '-');
    await sink.write('owned report', signal());
    const temporary = (await readdir(directory)).find(name => name.endsWith('.tmp'));
    if (process.platform === 'linux') {
      expect(temporary).toBeUndefined(); const foreign = path.join(directory, '.loglens-foreign.tmp');
      try { await writeFile(foreign, 'replacement'); await sink.commit(signal()); } finally { await sink.discard(); }
      expect(await readFile(target, 'utf8')).toBe('owned report');
      expect(await readFile(foreign, 'utf8')).toBe('replacement'); return;
    }
    if (!temporary) throw new Error('Missing temporary');
    const temp = path.join(directory, temporary);
    // Native Windows holds the exact file without write/delete sharing. Prove both
    // denial and ownership, then show ordinary replacement works after close.
    try {
      await expect(rename(temp, temp + '.owned')).rejects.toHaveProperty('code');
      await expect(writeFile(temp, 'replacement')).rejects.toHaveProperty('code');
      expect(await readFile(temp, 'utf8')).toBe('owned report');
      await sink.commit(signal());
    } finally { await sink.discard(); }
    expect(await readFile(target, 'utf8')).toBe('owned report');
    await writeFile(temp, 'replacement'); await rename(temp, temp + '.owned');
    await sink.discard();
    expect(await readFile(temp + '.owned', 'utf8')).toBe('replacement');
  });
  it('cancels a failed gzip source even when its producer keeps stdin open', async () => {
    const stdin = new Readable({ read() { /* hostile producer keeps the pipe open */ } });
    stdin.push(Buffer.from([31, 139, 8, 255, 0, 0, 0, 0, 0, 0, 255, 255]));
    const controller = new AbortController(); const generator = readInput('-', stdin, controller.signal);
    let completed = false;
    const operation = generator.next().then(() => { completed = true; return null; }, (error: unknown) => { completed = true; return error; });
    await new Promise(resolve => setTimeout(resolve, 250));
    const settledBeforeAbort = completed; controller.abort(); const error = await operation;
    expect(settledBeforeAbort).toBe(true); expect(error).toMatchObject({ code: 'GZIP_INVALID' }); expect(stdin.destroyed).toBe(true);
  }, 5000);
  it('a real CLI pipe recovers from gzip failure while the producer stays open', async () => {
    await writeFile(path.join(directory, 'next.log'), 'INFO next\n');
    const child = spawn(process.execPath, [bin, 'inspect', '-', path.join(directory, 'next.log'), '--output-format=json'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let errors = ''; child.stdout.on('data', chunk => { output += String(chunk); }); child.stderr.on('data', chunk => { errors += String(chunk); });
    child.stdin.on('error', () => undefined);
    const timeout = setTimeout(() => child.kill(), 3000);
    try {
      child.stdin.write(Buffer.from([31, 139, 8, 255, 0, 0, 0, 0, 0, 0, 255, 255]));
      const [code] = await once(child, 'close'); expect(code).toBe(3);
      expect(JSON.parse(output)).toMatchObject({ coverage: 'partial', stats: { eventsRead: 1 }, sources: [{ errors: ['GZIP_INVALID'] }, { eventsRead: 1, status: 'complete' }] });
      expect(errors).toContain('GZIP_INVALID');
    } finally { clearTimeout(timeout); child.stdin.destroy(); child.kill(); }
  }, 5000);
  it('JWT protection and injection escaping hold across every renderer and opt-out', () => {
    const token = '-abcdefg.ijklmnop.qrstuvw-';
    const input = JSON.stringify({ level: 'error', message: `hit ${token} </pre><script>x</script>\u001b\u202e`, service: token, requestId: token, logger: token, extra: token }) + '\n';
    for (const format of ['text', 'json', 'ndjson', 'html', 'markdown']) {
      const command = format === 'html' || format === 'markdown' ? 'report' : 'search';
      const args = [command, '-', `--output-format=${format}`, ...(command === 'search' ? ['--query=hit', ...(format === 'text' ? [] : ['--include-raw'])] : [])];
      const result = cli(args, input); expect(result.status).toBe(0); expect(result.stdout + result.stderr).not.toContain(token);
      expect(result.stdout).not.toContain('\u001b'); expect(result.stdout).not.toContain('\u202e');
      const unsafe = cli([...args, '--no-redact', '--ack-sensitive-output'], input);
      expect(unsafe.status).toBe(0); expect(unsafe.stdout).toContain(token); expect(unsafe.stdout).not.toContain('\u001b');
      if (format === 'html') expect(unsafe.stdout).not.toContain('<script>');
    }
  }, 15000);
  it('caps compressed bytes even when an unterminated gzip header produces no decoded bytes', async () => {
    const header = Buffer.concat([Buffer.from([31, 139, 8, 8, 0, 0, 0, 0, 0, 0]), Buffer.from('a'.repeat(256))]);
    const stdin = new Readable({ read() { /* no EOF */ } }); stdin.push(header);
    const generator = readInput('-', stdin, signal(), { bytesRead: 0 }, 64);
    await expect(generator.next()).rejects.toMatchObject({ code: 'SOURCE_BYTE_LIMIT' }); expect(stdin.destroyed).toBe(true);
    const { limits } = await import('../src/contracts/model.js');
    const run = { bytesRead: limits.runBytes };
    await expect(readInput('-', Readable.from([header]), signal(), run).next()).rejects.toMatchObject({ code: 'RUN_BYTE_LIMIT' });
    expect(run.bytesRead).toBe(limits.runBytes + header.length);
  });
});

describe('Stage 3 adversarial independent oracles', () => {
  it('checks exact escaped HTML bytes before expansion and preserves chunk boundaries', async () => {
    const action = parseArguments(['report', '-'], false); if (!('plan' in action)) throw new Error('Missing plan');
    const analysis = createAnalysis(action.plan, (e, m, r) => project(e, m, true, false, r), v => v);
    const parsed = (await records('ERROR <&>"\' 😀\n'))[0]; if (!parsed) throw new Error('Missing escaped event');
    analysis.accept(parsed, { ...source, status: 'complete', bytesRead: 0, eventsRead: 0, damagedEvents: 0, errors: [] });
    const result = analysis.finish(); const html = renderReport(result, 'html'); const size = Buffer.byteLength(html);
    expect(renderReport(result, 'html', size)).toBe(html);
    expect(() => renderReport(result, 'html', size - 1)).toThrowError('OUTPUT_LIMIT');
    const text = 'x'.repeat(16383) + '😀<&>"\'';
    expect(escapeHtml(text)).toBe('x'.repeat(16383) + '😀&lt;&amp;&gt;&quot;&#39;');
    expect(prefix('a😀z', 4)).toBe('a'); expect(prefix('a😀z', 5)).toBe('a😀');
    expect(prefix('a\ud800z', 4)).toBe('a\ud800');
  });
  it('preserves distinct metadata values when protected keys collide', () => {
    expect(protectJson({ 'token=A': 1, 'token=B': 2, 'token=[REDACTED]:2': 3 })).toEqual({
      'token=[REDACTED]': 1, 'token=[REDACTED]:2': 2, 'token=[REDACTED]:2:2': 3
    });
  });
  it('reserves aggregation bytes for later count and timestamp-bound growth', async () => {
    const action = parseArguments(['group', '-', '--top=10000'], false); if (!('plan' in action)) throw new Error('Missing plan');
    const parsed = (await records('{"level":"error","message":"same"}\n'))[0];
    const timed = (await records('{"time":0,"level":"error","message":"same"}\n'))[0];
    if (!parsed || !timed) throw new Error('Missing events');
    const analysis = createAnalysis(action.plan, (e, m, r) => project(e, m, true, false, r), v => v);
    const outcome = { ...source, status: 'complete', bytesRead: 0, eventsRead: 0, damagedEvents: 0, errors: [] } as const;
    analysis.accept(parsed, { ...outcome, errors: [] }); const admittedBytes = analysis.retainedBytes();
    for (let i = 0; i < 100; i++) analysis.accept(timed, { ...outcome, errors: [] });
    const row = analysis.finish().groups[0]; if (!row) throw new Error('Missing group');
    const retainedSerialization = Buffer.byteLength(canonical({ digest: row.key, tuple: fingerprint(parsed), row })) + 512;
    expect(row.count).toBe(101); expect(row.firstSeen).toBe('1970-01-01T00:00:00.000Z');
    expect(admittedBytes).toBeGreaterThanOrEqual(retainedSerialization); expect(analysis.retainedBytes()).toBe(admittedBytes);
  });
  it('preserves counts, time bounds and correlations across duplicate and missing evidence', () => {
    const input = [
      { time: -1, level: 'error', message: 'E_DB: failure', requestId: 'R', traceId: 'R' },
      { time: 0, level: 'error', message: 'E_DB: failure', requestId: 'R' },
      { time: 0, level: 'warn', message: 'notice', spanId: 'S' },
      { time: 60000, level: 'fatal', message: 'E_NET: failure' },
      { message: 'unknown' }
    ].map(e => JSON.stringify(e)).join('\r\n');
    const report = cli(['report', '-', '--bucket=1m', '--output-format=json'], input);
    expect(report.status).toBe(0); const result: unknown = JSON.parse(report.stdout);
    expect(result).toMatchObject({ stats: { eventsRead: 5, selectedEvents: 5, physicalLines: 5, damagedEvents: 0 },
      summary: { timedEvents: 4, untimedEvents: 1, earliest: '1969-12-31T23:59:59.999Z', latest: '1970-01-01T00:01:00.000Z',
        severity: { error: 2, fatal: 1, warn: 1, unknown: 1 } },
      groups: [{ count: 2 }, { count: 1 }], timeline: [{ count: 1 }, { count: 2 }, { count: 1 }],
      correlations: [{ key: 'request:g1', count: 2 }, { key: 'trace:g1', count: 1 }, { key: 'span:g1', count: 1 }] });
    const filtered = cli(['inspect', '-', '--since=1970-01-01T00:00:00Z', '--until=1970-01-01T00:01:00Z', '--output-format=json'], input);
    expect(JSON.parse(filtered.stdout)).toMatchObject({ stats: { eventsRead: 5, selectedEvents: 2, timeExcludedMissing: 1 } });
  });
  it('fault recovery retains pending bytes/hash and exact provenance without a fabricated event', async () => {
    const { AppError } = await import('../src/contracts/model.js');
    const bytes = Buffer.from('ERROR TypeError: bad\r\n  detail');
    async function* input() { yield bytes; throw new AppError('INPUT_READ'); }
    const events: Parsed[] = []; const progress = { bytesRead: 0, physicalLines: 0 };
    await expect((async () => { for await (const event of parseRecords(frameLines(input(), progress, signal()), source,
      { format: 'auto', assumeTimezone: null }, () => undefined)) events.push(event); })()).rejects.toMatchObject({ code: 'INPUT_READ' });
    expect(events).toHaveLength(1); expect(events[0]?.event).toMatchObject({ position: { lineStart: 1, lineEnd: 2, byteStart: 0, byteEnd: bytes.length },
      raw: { byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } });
    expect(events[0]?.codes.has('SOURCE_TRUNCATED')).toBe(true);
    expect(canonical(events[0]?.event)).not.toContain('undefined');
  });
  it('cleans stream listeners after completed writes and rejects already closed sinks promptly', async () => {
    const { Writable } = await import('node:stream');
    const writer = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const controller = new AbortController();
    for (let i = 0; i < 100; i++) await writeStream(writer, 'x', controller.signal);
    expect(writer.listenerCount('error')).toBe(0); expect(writer.listenerCount('close')).toBe(0);
    writer.destroy(); await new Promise(resolve => setImmediate(resolve));
    await expect(writeStream(writer, 'x', controller.signal)).rejects.toMatchObject({ code: 'OUTPUT_WRITE' });
  });
  it('handles Unicode/spaces/-- paths and PowerShell-style LF output without modifying input', async () => {
    const input = path.join(directory, 'ação e espaço.log'); const content = 'INFO ação\r\nERROR fail'; await writeFile(input, content);
    const target = path.join(directory, 'resultado ação.json'); const result = cli(['inspect', input, '--output-format=json', '--output', target], '');
    expect(result.status).toBe(0); expect(result.stdout).toBe(''); expect(await readFile(input, 'utf8')).toBe(content);
    const output = await readFile(target, 'utf8'); expect(output).not.toContain('\r'); expect(JSON.parse(output)).toMatchObject({ stats: { eventsRead: 2 } });
    await unlink(target);
    const action = parseArguments(['inspect', '--output-format=json', '--', '-ação.log'], false); expect(action.kind).toBe('inspect');
  });
});
