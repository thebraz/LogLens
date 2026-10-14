import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile, appendFile, truncate, symlink, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createFileSink, writeStream } from '../src/io/sink.js';
import { readInput } from '../src/io/input.js';
import { openInput } from '../src/io/paths.js';
import { frameLines } from '../src/io/framing.js';
import { runCommand } from '../src/cli/run.js';
import { parseArguments, version } from '../src/cli/args.js';
import { AppError, limits } from '../src/contracts/model.js';
import { parseLine } from '../src/core/parser.js';

const bin = path.resolve('dist/bin.js');
const fixture = path.resolve('tests/fixtures/seven.log');
let directory: string;
const signal = () => new AbortController().signal;
function cli(args: string[], input: string | Buffer = '', cwd = directory) {
  const result = spawnSync(process.execPath, [bin, ...args], { input, encoding: 'utf8', cwd, timeout: 10000, env: { ...process.env, TZ: 'Pacific/Honolulu', LANG: 'pt_BR.UTF-8' } });
  if (result.error) throw result.error;
  return result;
}
function capture() {
  let value = '';
  const writer = new Writable({ write(chunk: Buffer, _encoding, callback) { value += chunk.toString(); callback(); } });
  return { writer, text: () => value };
}
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'loglens-test-')); });
afterEach(async () => {
  const root = path.resolve(os.tmpdir()); const target = path.resolve(directory);
  if (path.dirname(target) !== root || !path.basename(target).startsWith('loglens-test-')) throw new Error('Unsafe test cleanup');
  await rm(target, { recursive: true, force: true });
});

describe('real built CLI', () => {
  it('help/version perform no input access, help takes precedence, and version matches metadata', async () => {
    const result = cli(['inspect', 'missing', '--unknown', '--help']);
    expect(result.status).toBe(0); expect(result.stderr).toBe(''); expect(result.stdout).toContain('inspect|search|group|report');
    const metadata: unknown = JSON.parse(await readFile('package.json', 'utf8'));
    expect(metadata).toMatchObject({ version, private: true, license: 'MIT' });
    expect(cli(['--version']).stdout).toBe(version + '\n'); expect(cli(['--version']).status).toBe(0);
  });
  it('inspects seven severities with exact counts, timestamp coverage and source outcomes', () => {
    const result = cli(['inspect', fixture, '--output-format=json']);
    expect(result.status).toBe(0); expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ schemaVersion: 'loglens.output.v1', command: 'inspect', coverage: 'complete',
      stats: { eventsRead: 7, selectedEvents: 7, damagedEvents: 0, physicalLines: 7, blankLines: 0, diagnosticCounts: {} },
      summary: { severity: { trace: 1, debug: 1, info: 1, warn: 1, error: 1, fatal: 1, unknown: 1 },
        timedEvents: 3, untimedEvents: 4, earliest: '2026-10-13T08:00:00.000Z', latest: '2026-10-13T12:00:00.000Z' },
      sources: [{ id: 's000001', label: 'seven.log', kind: 'file', status: 'complete', eventsRead: 7, damagedEvents: 0, errors: [] }],
      events: [], groups: [], timeline: [], correlations: [], redaction: { enabled: true, policyVersion: 1 } });
    expect(result.stdout.endsWith('\n')).toBe(true); expect(result.stdout).not.toContain(path.dirname(fixture));
  });
  it('stdin and file have identical analysis and byte counters, with only source provenance different', async () => {
    const bytes = await readFile(fixture);
    const file = JSON.parse(cli(['inspect', fixture, '--output-format=json']).stdout);
    const stdin = JSON.parse(cli(['inspect', '--output-format=json'], bytes).stdout);
    expect(stdin.stats).toEqual(file.stats); expect(stdin.summary).toEqual(file.summary);
    expect(stdin.sources[0]).toMatchObject({ label: 'stdin', kind: 'stdin', status: 'complete' });
    expect(stdin.stats.bytesRead).toBe(bytes.length);
    expect(cli(['inspect', '-'], bytes).status).toBe(0);
  });
  it('machine output is byte-identical across repeated processes and different timezone/locale', () => {
    const first = cli(['inspect', fixture, '--output-format=json']).stdout;
    const other = spawnSync(process.execPath, [bin, 'inspect', fixture, '--output-format=json'], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', LANG: 'en_US.UTF-8' } });
    expect(other.status).toBe(0); expect(other.stdout).toBe(first);
  });
  it('text summary labels follow the public order and are monochrome', () => {
    const result = cli(['inspect', fixture]);
    const labels = result.stdout.split('\n').filter(line => /^[A-Z]/.test(line)).map(line => line.split(':')[0]);
    expect(labels).toEqual(['Coverage', 'Redaction', 'Events read', 'Selected events', 'Damaged events', 'Timed events', 'Untimed events', 'Earliest', 'Latest', 'Severity', 'Sources', 'Diagnostics', 'Limits']);
    expect(result.stdout).not.toContain('\x1b'); expect(result.status).toBe(0);
  });
  it('damaged records produce usable JSON and exit 3, with deduplicated machine stderr diagnostics', () => {
    const result = cli(['inspect', path.resolve('tests/fixtures/damaged.log'), '--output-format=json']);
    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout)).toMatchObject({ coverage: 'partial', stats: { eventsRead: 3, damagedEvents: 2,
      diagnosticCounts: { MALFORMED_JSON: 1, INVALID_TIME: 1, UNKNOWN_SEVERITY: 1 } } });
    const diagnostics = result.stderr.trim().split('\n').map(line => JSON.parse(line));
    expect(diagnostics.map(d => d.code)).toEqual(['INVALID_TIME', 'MALFORMED_JSON', 'UNKNOWN_SEVERITY']);
    expect(diagnostics.every(d => d.schemaVersion === 'loglens.output.v1' && d.type === 'diagnostic' && d.sourceId === 's000001')).toBe(true);
    expect(result.stderr).not.toContain('bad time');
  });
  it('unknown severity alone stays complete, with a visible diagnostic', () => {
    const result = cli(['inspect', '-', '--output-format=json'], '{"level":42,"message":"hi"}\n');
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ coverage: 'complete', stats: { damagedEvents: 0, diagnosticCounts: { UNKNOWN_SEVERITY: 1 } } });
  });
  it('empty files and blank-only stdin are complete with null time bounds', async () => {
    const empty = path.join(directory, 'empty.log'); await writeFile(empty, '');
    const result = cli(['inspect', empty, '--output-format=json']);
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ stats: { bytesRead: 0, eventsRead: 0, physicalLines: 0 },
      summary: { earliest: null, latest: null, timedEvents: 0, untimedEvents: 0 } });
    const blank = cli(['inspect', '-', '--output-format=json'], '\n \t\r\n');
    expect(blank.status).toBe(0); expect(JSON.parse(blank.stdout).stats).toMatchObject({ eventsRead: 0, blankLines: 2, physicalLines: 2 });
  });
  it('missing and directory inputs return 4 with an empty aggregate and safe stderr', () => {
    const missing = cli(['inspect', 'password=CANARY_MISSING', '--output-format=json']);
    expect(missing.status).toBe(4); expect(JSON.parse(missing.stdout)).toMatchObject({ coverage: 'partial', stats: { eventsRead: 0 },
      sources: [{ status: 'failed', label: 'password=[REDACTED]', errors: ['INPUT_NOT_FOUND'] }] });
    expect(missing.stderr).not.toContain('CANARY_MISSING'); expect(cli(['inspect', directory]).status).toBe(4);
  });
  it.each([
    ['inspect', '--output-format=html'], ['inspect', '--query=x'],
    ['inspect', '--format=text', '--format=text'], ['inspect', '--no-redact'],
    ['search'], ['group', '--bucket=1h'], ['report', '--by=fingerprint'], ['inspect', '--version']
  ])('unsupported argv %j returns stderr-only exit 2', (...args) => {
    const result = cli(args); expect(result.status).toBe(2); expect(result.stdout).toBe(''); expect(result.stderr).toMatch(/USAGE|NOT_AVAILABLE/);
  });
  it('usage errors do not expose query values', () => {
    const result = cli(['search', '--query', 'password=CANARY_QUERY', '--before=-1', '--output-format=json']);
    expect(result.status).toBe(2); expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr).code).toBe('USAGE'); expect(result.stderr).not.toContain('CANARY_QUERY');
  });
  it('honors positional -- for dash-prefixed literal filenames', async () => {
    await writeFile(path.join(directory, '-test.log'), 'INFO safe');
    expect(cli(['inspect', '--output-format=json', '--', '-test.log']).status).toBe(0);
  });
  it('applies explicit fixed timezone only when supplied', () => {
    const naive = '2026-10-13 12:00:00 INFO ready\n';
    expect(cli(['inspect', '-', '--output-format=json'], naive).status).toBe(3);
    const fixed = cli(['inspect', '-', '--output-format=json', '--assume-timezone=-03:00'], naive);
    expect(fixed.status).toBe(0); expect(JSON.parse(fixed.stdout).summary.earliest).toBe('2026-10-13T15:00:00.000Z');
  });
  it('rejects invalid gzip and unsupported encoding with 4', async () => {
    const zipped = path.join(directory, 'anything.gz'); await writeFile(zipped, 'INFO not gzip');
    expect(cli(['inspect', zipped]).status).toBe(4);
    expect(cli(['inspect', '-'], Buffer.from([31, 139, 8, 0])).status).toBe(4);
    expect(cli(['inspect', '-'], Buffer.from([255, 254, 65, 0])).status).toBe(4);
  });
  it('writes a new complete or partial result without mutating the input or overwriting an existing destination', async () => {
    const before = await readFile(fixture); const destination = path.join(directory, 'summary.json');
    expect(cli(['inspect', fixture, '--output-format=json', '--output', destination]).status).toBe(0);
    const output = await readFile(destination, 'utf8'); expect(JSON.parse(output).stats.eventsRead).toBe(7);
    const again = cli(['inspect', fixture, '--output', destination]); expect(again.status).toBe(4); expect(again.stderr).toContain('OUTPUT_EXISTS');
    expect(await readFile(destination, 'utf8')).toBe(output); expect(await readFile(fixture)).toEqual(before);
    expect((await readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    const partial = path.join(directory, 'partial.json');
    expect(cli(['inspect', '-', '--output-format=json', '--output', partial], '{bad\n').status).toBe(3);
    expect(JSON.parse(await readFile(partial, 'utf8')).coverage).toBe('partial');
  });
  it('does not commit output on input failure and rejects missing parents/input aliases', async () => {
    const target = path.join(directory, 'result.json');
    expect(cli(['inspect', 'missing', '--output', target]).status).toBe(4); expect(await readdir(directory)).toEqual([]);
    expect(cli(['inspect', fixture, '--output', path.join(directory, 'missing', 'x')]).status).toBe(4);
    expect(cli(['inspect', fixture, '--output', fixture]).status).toBe(4);
  });
  it('protects fake credentials and control sequences in every emitted field and committed result', async () => {
    const filename = 'password=CANARY_FILENAME.log'; const input = path.join(directory, filename);
    const canaries = ['CANARY_FILENAME', 'CANARY_MESSAGE', 'CANARY_ATTRIBUTE'];
    await writeFile(input, JSON.stringify({ message: 'password=CANARY_MESSAGE\x1b]52;bad\x07', token: 'CANARY_ATTRIBUTE', time: 'invalid' }) + '\n');
    for (const format of ['json', 'text']) {
      const dest = path.join(directory, `protected.${format}`);
      const result = cli(['inspect', input, '--output-format', format, '--output', dest]); expect(result.status).toBe(3);
      const rendered = await readFile(dest, 'utf8');
      for (const canary of canaries) expect(result.stdout + result.stderr + rendered).not.toContain(canary);
      expect(rendered).not.toContain('\x1b'); expect(rendered).not.toContain('\x07'); expect(rendered).toContain('[REDACTED]');
    }
    expect((await readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(false);
  });
  it('invalid UTF-8 is partial and retains exact byte/line counters', () => {
    const result = cli(['inspect', '-', '--output-format=json'], Buffer.from([0x61, 0xff, 10, 0x62]));
    expect(result.status).toBe(3); expect(JSON.parse(result.stdout).stats).toMatchObject({ bytesRead: 4, physicalLines: 2,
      eventsRead: 2, damagedEvents: 1, diagnosticCounts: { INVALID_UTF8: 1 } });
  });
});

describe('real I/O lifecycle and safety', () => {
  it('does not read appended data after the opened file size boundary', async () => {
    const file = path.join(directory, 'append.log'); await writeFile(file, 'a'.repeat(limits.chunk) + '\nINFO original\n');
    const generator = readInput(file, Readable.from([]), signal());
    const first = await generator.next(); expect(first.value?.length).toBe(limits.chunk);
    await appendFile(file, 'ERROR appended\n'); let remaining = '';
    for await (const chunk of generator) remaining += Buffer.from(chunk).toString();
    expect(remaining).toBe('\nINFO original\n');
    await rename(file, file + '.closed');
  });
  it('detects shrinking an already opened file, flushes pending evidence and closes its descriptor', async () => {
    const file = path.join(directory, 'shrink.log'); await writeFile(file, 'a'.repeat(limits.chunk * 2));
    const input = readInput(file, Readable.from([]), signal());
    async function* shrink() {
      const first = await input.next(); if (first.value) yield first.value;
      await truncate(file, 0); yield* input;
    }
    const progress = { bytesRead: 0, physicalLines: 0 }; const events = [];
    try { for await (const line of frameLines(shrink(), progress, signal())) events.push(line); }
    catch (error) { expect(error).toMatchObject({ code: 'SOURCE_TRUNCATED' }); }
    expect(events).toHaveLength(1); const first = events[0]; if (!first) throw new Error('Missing partial event');
    expect(first.position.byteEnd).toBe(limits.chunk);
    expect(parseLine(first, { id: 's000001', label: 'shrink.log', kind: 'file' }, 1, { format: 'auto', assumeTimezone: null }).codes.has('SOURCE_TRUNCATED')).toBe(true);
    await rename(file, file + '.closed');
  });
  it('rejects actual directory junctions/symlink ancestors for input and output', async () => {
    const real = path.join(directory, 'real'); const junction = path.join(directory, 'alias');
    await mkdir(real); await writeFile(path.join(real, 'input.log'), 'INFO ok');
    await symlink(real, junction, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(openInput(path.join(junction, 'input.log'))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(createFileSink(path.join(junction, 'output.json'), '-')).rejects.toMatchObject({ code: 'UNSAFE_OUTPUT' });
    expect(await readdir(real)).toEqual(['input.log']);
  });
  it('atomic no-replace commit preserves a raced destination and removes only its own temp', async () => {
    const target = path.join(directory, 'raced.json'); const sink = await createFileSink(target, '-');
    await sink.write('result\n', signal()); await writeFile(target, 'winner');
    await expect(sink.commit(signal())).rejects.toMatchObject({ code: 'OUTPUT_EXISTS' }); await sink.discard();
    expect(await readFile(target, 'utf8')).toBe('winner'); expect(await readdir(directory)).toEqual(['raced.json']);
  });
  it('discards uncommitted temp; POSIX modes are asserted only on POSIX', async () => {
    const sink = await createFileSink(path.join(directory, 'never.json'), '-');
    const temp = (await readdir(directory))[0];
    if (process.platform === 'linux') expect(temp).toBeUndefined();
    else expect(temp).toMatch(/^\.loglens-.*\.tmp$/);
    if (process.platform !== 'win32' && temp) expect((await stat(path.join(directory, temp))).mode & 0o777).toBe(0o600);
    await sink.write('safe', signal()); await sink.discard(); expect(await readdir(directory)).toEqual([]);
  });
  it('awaits a slow writable callback and does not pull the next item until it completes', async () => {
    let pulled = 0; let consumed = ''; let release: (() => void) | undefined;
    const writer = new Writable({ highWaterMark: 1, write(chunk: Buffer, _encoding, callback) {
      consumed += chunk.toString(); release = callback;
    } });
    async function* producer() { pulled++; yield 'first'; pulled++; yield 'second'; }
    const operation = (async () => { for await (const value of producer()) await writeStream(writer, value, signal()); })();
    await new Promise(resolve => setImmediate(resolve)); expect(pulled).toBe(1); expect(consumed).toBe('first');
    release?.(); await new Promise(resolve => setImmediate(resolve)); expect(pulled).toBe(2); expect(consumed).toBe('firstsecond');
    release?.(); await operation;
  });
  it('cancellation stops a waiting stdin read, destroys its source and removes temporary output', async () => {
    const stdin = new Readable({ read() { /* Wait for cancellation. */ } });
    const stdout = capture(); const stderr = capture(); const controller = new AbortController();
    const action = parseArguments(['inspect', '-', '--output-format=json', '--output', path.join(directory, 'cancel.json')], false);
    if (!('plan' in action)) throw new Error('Expected plan');
    const operation = runCommand(action.plan,
      { stdin, stdout: stdout.writer, stderr: stderr.writer, signal: controller.signal });
    const assertion = expect(operation).rejects.toMatchObject({ code: 'INTERRUPTED' });
    await new Promise(resolve => setTimeout(resolve, 30));
    const before = performance.now(); controller.abort();
    await assertion;
    expect(performance.now() - before).toBeLessThan(2000); expect(stdin.destroyed).toBe(true);
    expect(stdout.text()).toBe(''); expect(await readdir(directory)).toEqual([]);
  });
  it('cancellation interrupts a stalled output write', async () => {
    const writer = new Writable({ write() { /* Intentionally stalled sink. */ } });
    const controller = new AbortController(); const pending = writeStream(writer, 'test', controller.signal); controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'INTERRUPTED' }); writer.destroy();
  });
  it('handles a failing writer callback and its subsequent error event without an unhandled error', async () => {
    const writer = new Writable({ write(_chunk, _encoding, callback) { callback(Object.assign(new Error('synthetic'), { code: 'EPIPE' })); } });
    await expect(writeStream(writer, 'test', signal())).rejects.toMatchObject({ code: 'EPIPE' });
    await new Promise(resolve => setImmediate(resolve)); expect(writer.destroyed).toBe(true);
  });
  it('still handles a pending write failure after cancellation', async () => {
    let fail: ((error: Error) => void) | undefined;
    const writer = new Writable({ write(_chunk, _encoding, callback) { fail = callback; } });
    const controller = new AbortController(); const pending = writeStream(writer, 'test', controller.signal); controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'INTERRUPTED' }); fail?.(new Error('synthetic'));
    await new Promise(resolve => setImmediate(resolve)); expect(writer.destroyed).toBe(true);
  });
  it('cancellation before commit leaves no destination or temp', async () => {
    const sink = await createFileSink(path.join(directory, 'cancel-commit.json'), '-'); await sink.write('safe', signal());
    const controller = new AbortController(); controller.abort();
    await expect(sink.commit(controller.signal)).rejects.toMatchObject({ code: 'INTERRUPTED' });
    await sink.discard(); expect(await readdir(directory)).toEqual([]);
  });
  it.each([['SIGINT', 130], ['SIGTERM', 143]] as const)('entry point handles injected %s in a real subprocess, closes input and discards output', async (event, status) => {
    const target = path.join(directory, 'signal.json');
    const script = `process.argv = [process.execPath, ${JSON.stringify(bin)}, 'inspect', '-', '--output', ${JSON.stringify(target)}];
      setTimeout(() => process.emit(${JSON.stringify(event)}), 300); await import(${JSON.stringify(pathToFileURL(bin).href)});`;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let errors = ''; child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
    const before = performance.now(); child.stdin.write('INFO pending\n');
    const [code] = await once(child, 'exit'); expect(code).toBe(status); expect(output + errors).toBe('');
    expect(performance.now() - before).toBeLessThan(2000); expect(await readdir(directory)).toEqual([]);
  });
  it('real subprocess EPIPE is quiet and returns 141', async () => {
    const child = spawn(process.execPath, [bin, 'inspect', fixture, '--output-format=json'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.stdout.destroy();
    const [code] = await once(child, 'exit'); expect(code).toBe(141); expect(stderr).toBe('');
  });
  it.skipIf(process.platform === 'win32')('POSIX SIGINT returns 130 without a normal completion envelope', async () => {
    const child = spawn(process.execPath, [bin, 'inspect', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stdin.write('INFO ready\n'); await new Promise(resolve => setTimeout(resolve, 200)); child.kill('SIGINT');
    const [code] = await once(child, 'exit'); expect(code).toBe(130); expect(output).toBe('');
  });
  it('enforces source bytes and safe integer invariants before unbounded consumption', async () => {
    async function* chunks() { yield Buffer.alloc(1); throw new Error('Must stop before another pull'); }
    const iterator = frameLines(chunks(), { bytesRead: limits.sourceBytes, physicalLines: 0 }, signal());
    await expect(iterator.next()).rejects.toMatchObject({ code: 'SOURCE_BYTE_LIMIT' });
    expect(new AppError('INPUT_READ').message).toBe('INPUT_READ');
  });
});
