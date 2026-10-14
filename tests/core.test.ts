import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { frameLines } from '../src/io/framing.js';
import { parseLine, severity, detectFormat } from '../src/core/parser.js';
import { parseTime, offsetMinutes } from '../src/core/time.js';
import { canonical } from '../src/core/json.js';
import { addCount, AppError, limits } from '../src/contracts/model.js';
import type { Line, Plan } from '../src/contracts/model.js';
import { createInspection } from '../src/core/inspect.js';
import { escapeControls, protectJson, redact } from '../src/output/protect.js';
import { parseArguments } from '../src/cli/args.js';

const source = { id: 's000001', label: 'test.log', kind: 'file' } as const;
export async function lines(bytes: Buffer, partitions: number[] = [bytes.length]) {
  async function* chunks() {
    let offset = 0;
    for (const length of partitions) { yield bytes.subarray(offset, offset + length); offset += length; }
    if (offset < bytes.length) yield bytes.subarray(offset);
  }
  const progress = { bytesRead: 0, physicalLines: 0 }; const output: Line[] = [];
  for await (const line of frameLines(chunks(), progress, new AbortController().signal)) output.push(line);
  return { output, progress };
}
async function parse(text: string, format: Plan['format'] = 'auto', assumeTimezone: string | null = null) {
  const framed = await lines(Buffer.from(text)); const line = framed.output[0];
  if (!line) throw new Error('Test needs one line');
  return parseLine(line, source, 1, { format, assumeTimezone });
}

describe('time and severity normalization', () => {
  it.each([
    ['2026-10-13T09:00:00-03:00', '2026-10-13T12:00:00.000Z'],
    ['2024-02-29 23:59:59.1Z', '2024-02-29T23:59:59.100Z'],
    [-1, '1969-12-31T23:59:59.999Z'], [1000, '1970-01-01T00:00:01.000Z'],
    ['0001-01-01T00:00:00Z', '0001-01-01T00:00:00.000Z'],
    ['9999-12-31T23:59:59.999Z', '9999-12-31T23:59:59.999Z']
  ])('accepts %s without time heuristics', (input, expected) => {
    expect(parseTime(input, null).timestamp?.isoUtc).toBe(expected);
    expect(parseTime(input, null).code).toBeNull();
  });
  it.each(['2026-02-30T12:00:00Z', '2023-02-29T12:00:00Z', '2026-01-01T00:00:60Z',
    '2026-01-01T00:00:00.1234Z', '2026-01-01', '2026-01-01T00:00:00-00:00',
    '2026-01-01T00:00:00+14:01', '0000-01-01T00:00:00Z', '0001-01-01T00:00:00+14:00',
    '9999-12-31T23:59:59-14:00', 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid time %s', input => {
    expect(parseTime(input, null)).toEqual({ timestamp: null, code: 'INVALID_TIME' });
  });
  it('requires a supplied fixed timezone; never inherits the host', () => {
    expect(parseTime('2026-10-13 12:00:00', null).code).toBe('AMBIGUOUS_TIME');
    expect(parseTime('2026-10-13 12:00:00', '+03:00').timestamp).toMatchObject({
      isoUtc: '2026-10-13T09:00:00.000Z', interpretation: 'assumed-offset'
    });
    expect(offsetMinutes('-00:00')).toBeNull(); expect(offsetMinutes('+14:00')).toBe(840);
  });
  it.each([['information', 'info'], [' WARNING ', 'warn'], ['ERR', 'error'], ['crit', 'fatal'],
    ['unknownWord', 'unknown'], [40, 'unknown']])('normalizes only the specified alias %s', (input, expected) => {
    expect(severity(input)).toBe(expected);
  });
});

describe('byte framing and provenance', () => {
  it('is invariant at every split through BOM, UTF-8 and CRLF', async () => {
    const bytes = Buffer.from('\uFEFF[INFO] ação 😀\r\n\r\nlast\rword');
    const whole = await lines(bytes);
    for (let split = 0; split <= bytes.length; split++) expect(await lines(bytes, [split])).toEqual(whole);
    expect(await lines(bytes, new Array<number>(bytes.length).fill(1))).toEqual(whole);
    expect(whole.output.map(l => l.text)).toEqual(['[INFO] ação 😀', '', 'last\rword']);
    const first = Buffer.from('\uFEFF[INFO] ação 😀\r\n');
    expect(whole.output[0]).toMatchObject({ position: { lineStart: 1, lineEnd: 1, byteStart: 0, byteEnd: first.length },
      byteLength: first.length, sha256: createHash('sha256').update(first).digest('hex'), complete: true, invalidUtf8: false });
    expect(whole.progress).toEqual({ bytesRead: bytes.length, physicalLines: 3 });
  });
  it('preserves noninitial BOM, lone CR, NUL, final no-newline and exact raw hashes', async () => {
    const result = await lines(Buffer.from('a\n\uFEFFb\0\rc'));
    expect(result.output.map(l => l.text)).toEqual(['a', '\uFEFFb\0\rc']);
    expect(result.output[1]?.position).toEqual({ lineStart: 2, lineEnd: 2, byteStart: 2, byteEnd: 9 });
  });
  it('has zero lines for zero bytes, and one for LF', async () => {
    expect((await lines(Buffer.alloc(0))).output).toEqual([]);
    expect((await lines(Buffer.from('\n'))).output.map(l => l.text)).toEqual(['']);
  });
  it('flags invalid bytes but not legitimate U+FFFD; hashes original bytes', async () => {
    const bytes = Buffer.from([0x61, 0xc3, 0x28, 10]);
    const result = await lines(bytes, [2, 1, 1]);
    expect(result.output[0]).toMatchObject({ text: 'a�(', invalidUtf8: true, sha256: createHash('sha256').update(bytes).digest('hex') });
    expect((await lines(Buffer.from('�'))).output[0]?.invalidUtf8).toBe(false);
    expect((await lines(Buffer.from([0xe2, 0x82]))).output[0]?.invalidUtf8).toBe(true);
  });
  it.each([[255, 254], [254, 255], [0, 0, 254, 255]].map(bytes => ({ bytes })))('rejects UTF-16/32 BOM $bytes', async ({ bytes }) => {
    await expect(lines(Buffer.from(bytes), new Array<number>(bytes.length).fill(1))).rejects.toMatchObject({ code: 'UNSUPPORTED_ENCODING' });
  });
  it('frames decompressed bytes only; compression recognition belongs to the reader', async () => {
    expect((await lines(Buffer.from([31, 139, 8, 0]), [1, 1, 1, 1])).progress.bytesRead).toBe(4);
  });
  it.each([-1, 0, 1])('enforces the physical-line boundary %+d with CRLF and drains oversized lines', async delta => {
    const bytes = Buffer.from('a'.repeat(limits.line + delta) + '\r\nINFO next\n');
    const result = await lines(bytes, new Array<number>(Math.ceil(bytes.length / 65536)).fill(65536));
    expect(result.output).toHaveLength(2); const first = result.output[0]; if (!first) throw new Error('Missing line');
    expect(first.complete).toBe(delta <= 0); expect(first.text.length).toBe(delta <= 0 ? limits.line + delta : limits.prefix);
    expect(first.sha256).toBe(createHash('sha256').update(bytes.subarray(0, limits.line + delta + 2)).digest('hex'));
    expect(first.byteLength).toBe(limits.line + delta + 2); expect(result.output[1]?.text).toBe('INFO next');
    if (delta > 0) expect(parseLine(first, source, 1, { format: 'jsonl', assumeTimezone: null }).codes).toEqual(new Set(['LINE_TOO_LARGE', 'FIELD_TOO_LARGE']));
  });
});

describe('per-record recognition and canonical events', () => {
  it('detects each record by content and honors overrides', () => {
    expect(detectFormat('  {"message":"hi"}', 'auto')).toBe('jsonl');
    expect(detectFormat('[1]', 'auto')).toBe('text'); expect(detectFormat('{}', 'text')).toBe('text');
  });
  it('preserves every canonical field and alias, raw provenance and last duplicate key', async () => {
    const parsed = await parse('{"time":-1,"level":"WARN","msg":"first","msg":"last","serviceName":" api ","loggerName":"x","request_id":"a","trace_id":"b","span_id":"c","extra":true}\n');
    expect(parsed.event).toMatchObject({ schemaVersion: 'loglens.event.v1', id: 's000001:e1', source,
      timestamp: { epochMs: -1, interpretation: 'epoch-ms', original: '-1' }, severity: 'warn', severityOriginal: 'WARN',
      message: 'last', service: ' api ', logger: 'x', correlation: { requestId: 'a', traceId: 'b', spanId: 'c' },
      attributes: { extra: true }, format: 'jsonl', diagnostics: [] });
    expect(parsed.damaged).toBe(false); expect(parsed.event.raw.text.endsWith('\n')).toBe(false);
    expect(Object.keys(parsed.event)).toHaveLength(15);
  });
  it('missing fields are explicit nulls and missing message is damaged', async () => {
    const empty = await parse('{}');
    expect(empty.event).toMatchObject({ timestamp: null, severity: 'unknown', severityOriginal: null, message: '', service: null, logger: null,
      correlation: { requestId: null, traceId: null, spanId: null } });
    expect(empty.codes).toEqual(new Set(['MISSING_MESSAGE']));
    const valid = await parse('{"message":""}'); expect(valid.damaged).toBe(false);
  });
  it('wrong first alias blocks fallback; null permits fallback and conflicts remain visible', async () => {
    const first = await parse('{"timestamp":false,"time":1,"message":false,"msg":"valid","level":null,"severity":"ERR"}');
    expect(first.event).toMatchObject({ timestamp: null, message: '', severity: 'error', attributes: {} });
    expect(first.codes).toEqual(new Set(['INVALID_TIME', 'INVALID_FIELD', 'CONFLICTING_FIELDS']));
  });
  it('unknown structured/bracketed levels are informational; arbitrary text words are untouched', async () => {
    const bracket = await parse('[UNMAPPED] hi'); expect(bracket.event.message).toBe('hi'); expect(bracket.damaged).toBe(false);
    expect(bracket.codes).toEqual(new Set(['UNKNOWN_SEVERITY']));
    expect((await parse('UNMAPPED hi')).event.message).toBe('UNMAPPED hi');
    expect((await parse('{"level":40,"message":"ok"}')).event.severityOriginal).toBe('40');
  });
  it.each([
    ['2026-10-13T09:00:00-03:00 ERROR payment failed', 'payment failed', 'error', '2026-10-13T12:00:00.000Z'],
    ['[2026-10-13 12:00:00Z] [WARN] - cache miss  ', 'cache miss  ', 'warn', '2026-10-13T12:00:00.000Z'],
    ['2026-10-13T12:00:00Z free text', 'free text', 'unknown', '2026-10-13T12:00:00.000Z'],
    ['INFO', '', 'info', null], ['hello world', 'hello world', 'unknown', null],
    ['2026-02-30T12:00:00Z INFO bad', 'bad', 'info', null]
  ])('parses text %s with exact message boundaries', async (text, message, level, iso) => {
    const result = await parse(text); expect(result.event.message).toBe(message); expect(result.event.severity).toBe(level);
    expect(result.event.timestamp?.isoUtc ?? null).toBe(iso);
  });
  it('does not silently discard malformed JSON or reinterpret explicit text/JSON', async () => {
    expect((await parse('{"level":')).codes).toEqual(new Set(['MALFORMED_JSON']));
    expect((await parse('[]', 'jsonl')).codes).toEqual(new Set(['NON_OBJECT_JSON']));
    expect((await parse('ERROR hi', 'jsonl')).event).toMatchObject({ severity: 'unknown', message: 'ERROR hi', format: 'text' });
    expect((await parse('{"level":"ERROR"}', 'text')).codes.size).toBe(0);
  });
  it('sanitizes dangerous nested keys without prototype mutation', async () => {
    const parsed = await parse('{"message":"hi","__proto__":{"evil":1},"x":{"constructor":1,"prototype":2,"safe":[{"__proto__":3,"ok":4}]}}');
    expect(parsed.event.attributes).toEqual({ x: { safe: [{ ok: 4 }] } }); expect(parsed.codes).toEqual(new Set(['UNSAFE_KEY']));
    expect(Object.hasOwn(Object.prototype, 'evil')).toBe(false);
  });
  it('rejects unsafe/nonfinite numbers, fixes Unicode surrogates and preserves escaped raw evidence', async () => {
    const parsed = await parse('{"message":"\\ud800","level":1e400,"time":9007199254740992,"n":9007199254740992}');
    expect(parsed.event).toMatchObject({ message: '�', severityOriginal: null, timestamp: null, attributes: {} });
    expect(parsed.codes).toEqual(new Set(['INVALID_UNICODE', 'INVALID_NUMBER', 'INVALID_FIELD', 'INVALID_TIME']));
    expect(parsed.event.raw.text).toContain('\\ud800');
  });
  it('caps strings at UTF-8 boundaries and clears oversized join identifiers', async () => {
    const parsed = await parse(JSON.stringify({ message: '😀'.repeat(5000), service: 'a'.repeat(257), requestId: 'a'.repeat(513), level: 'X'.repeat(20000) }));
    expect(Buffer.byteLength(parsed.event.message)).toBe(limits.message); expect(parsed.event.service).toBeNull();
    expect(parsed.event.correlation.requestId).toBeNull(); expect(parsed.event.severityOriginal?.length).toBe(limits.message);
    expect(parsed.event.raw.complete).toBe(true); expect(parsed.damaged).toBe(true);
  });
  it.each(['depth', 'nodes', 'bytes'])('discards metadata exceeding %s limit', async kind => {
    const value = kind === 'depth' ? '{"x":'.repeat(34) + '1' + '}'.repeat(34)
      : kind === 'nodes' ? JSON.stringify(new Array<number>(10001).fill(0)) : JSON.stringify('x'.repeat(65536));
    const result = await parse('{"message":"ok","extra":' + value + '}');
    expect(result.event.attributes).toEqual({}); expect(result.codes.has('METADATA_LIMIT')).toBe(true);
  });
  it('caps diagnostic tuples while preserving observed codes and deterministic order', async () => {
    const extra = Object.fromEntries(new Array<number>(100).fill(0).map((_, i) => ['x' + i + '\ud800', '\ud800']));
    const result = await parse(JSON.stringify({ message: 'ok', extra }));
    // Duplicate same-field diagnostics collapse, rather than consuming retention.
    expect(result.event.diagnostics).toHaveLength(1); expect(result.codes).toEqual(new Set(['INVALID_UNICODE']));
    expect(result.event.diagnostics[0]?.field).toBe('attributes');
    expect(await parse(JSON.stringify({ message: 'ok', extra }))).toEqual(result);
  });
  it('single-line parser remains independent of multiline record framing', async () => {
    const framed = await lines(Buffer.from('ERROR boom\n  at app (a.js:1:2)\nCaused by: err\n'));
    const parsed = framed.output.map((line, i) => parseLine(line, source, i + 1, { format: 'auto', assumeTimezone: null }));
    expect(parsed.map(p => p.event.message)).toEqual(['boom', '  at app (a.js:1:2)', 'Caused by: err']);
    expect(parsed.map(p => p.event.severity)).toEqual(['error', 'unknown', 'unknown']);
    expect(parsed.map(p => p.event.position.lineStart)).toEqual([1, 2, 3]);
  });
});

describe('inspection, security and deterministic serialization', () => {
  it('counts duplicates, damage once, diagnostic code once per event, times out of order and blanks', async () => {
    const summary = createInspection(source); summary.blank();
    for (const text of ['{"time":2,"level":"error","message":"a"}', '{"time":-1,"level":"error","message":"a"}',
      '{"time":"bad","message":false,"msg":"x"}']) summary.accept(await parse(text));
    const result = summary.finish(123, 4, null);
    expect(result.stats).toMatchObject({ bytesRead: 123, eventsRead: 3, selectedEvents: 3, blankLines: 1, damagedEvents: 1,
      diagnosticCounts: { INVALID_TIME: 1, INVALID_FIELD: 1, CONFLICTING_FIELDS: 1 } });
    expect(result.summary).toMatchObject({ severity: { error: 2, unknown: 1 }, timedEvents: 2, untimedEvents: 1,
      earliest: '1969-12-31T23:59:59.999Z', latest: '1970-01-01T00:00:00.002Z' });
    expect(result.coverage).toBe('partial'); expect(result.sources[0]?.status).toBe('partial');
    expect(createInspection(source).finish(0, 0, null).summary).toMatchObject({ earliest: null, latest: null, timedEvents: 0 });
  });
  it('sorts numeric-looking and astral keys by Unicode code point rather than insertion/UTF-16 order', () => {
    expect(canonical({ '2': 2, '10': 10, '😀': 1, '\uE000': 3, a: { z: 2, b: 1 } }))
      .toBe('{"10":10,"2":2,"a":{"b":1,"z":2},"":3,"😀":1}');
    expect(() => addCount(Number.MAX_SAFE_INTEGER)).toThrow(AppError);
  });
  it.each([
    ['password=CANARY', 'password=[REDACTED]'], ['api_key: "CANARY x"', 'api_key: [REDACTED]'],
    ['password="CANARY\\"x" end', 'password=[REDACTED] end'], ['token="CANARY unmatched', 'token=[REDACTED]'],
    ['Authorization: Basic CANARY rest', 'Authorization: [REDACTED]'], ['Cookie: foo=CANARY; a=b', 'Cookie: [REDACTED]'],
    ['Bearer CANARY', 'Bearer [REDACTED]'], ['https://user:CANARY@host/path', 'https://[REDACTED]host/path'],
    ['sk-abcdefghijklmnop', '[REDACTED]'], ['ghp_abcdefghijklmnop', '[REDACTED]'],
    ['github_pat_abcdefghijklmnop', '[REDACTED]'], ['AKIAabcdefghijklmnop', '[REDACTED]'],
    ['abcdefgh.ijklmnop.qrstuvwx', '[REDACTED]'],
    ['-----BEGIN RSA PRIVATE KEY-----CANARY-----END RSA PRIVATE KEY-----', '[REDACTED]'],
    ['-----BEGIN RSA PRIVATE KEY-----CANARY', '[REDACTED]'],
    ['-----BEGIN PRIVATE KEY-----CANARY-----END PRIVATE KEY----- safe', '[REDACTED] safe'],
    ['{"password":"CANARY"}', '{"password":[REDACTED]}']
  ])('protects %s', (input, expected) => { expect(redact(input)).toBe(expected); expect(redact(redact(input))).toBe(expected); });
  it('documents misses and recursively protects sensitive values of every type', () => {
    expect(redact('sk-short email@example.com customCANARY')).toBe('sk-short email@example.com customCANARY');
    expect(protectJson({ nested: { 'Client-Secret': { anything: 'CANARY' }, safe: 'password=CANARY' }, token: 1 }))
      .toEqual({ nested: { 'Client-Secret': '[REDACTED]', safe: 'password=[REDACTED]' }, token: '[REDACTED]' });
    expect(escapeControls('\x1b]52;bad\x07\n\t\0\u202e\u2028')).toBe('\\u001b]52;bad\\u0007\\u000a\\u0009\\u0000\\u202e\\u2028');
  });
});

describe('argument contract', () => {
  it.each([[], ['inspect', '--format', 'bad'], ['inspect', '--format='],
    ['inspect', '--format=text', '--format=text'], ['inspect', '--no-redact'], ['inspect', '--level', 'INFO'],
    ['inspect', '--output-format=ndjson'], ['inspect', '--assume-timezone=-00:00'], ['inspect', '--assume-timezone=Z'],
    ['inspect', '--version'], ['--version=true'], ['inspect', '-x'], ['inspect', '--output=']].map(argv => ({ argv })))('rejects $argv', ({ argv }) => {
    expect(() => parseArguments(argv, false)).toThrow(AppError);
  });
  it('honors help precedence, explicit stdin, TTY guard and positional delimiter', () => {
    expect(parseArguments(['inspect', '--bad', '--help'], true)).toEqual({ kind: 'help' });
    expect(parseArguments(['--version'], true)).toEqual({ kind: 'version' });
    expect(() => parseArguments(['inspect'], true)).toThrow(AppError);
    expect(parseArguments(['inspect', '-'], true).kind).toBe('inspect');
    expect(parseArguments(['inspect', '--format=text', '--', '-file'], false)).toMatchObject({ plan: { inputs: ['-file'], format: 'text' } });
    expect(parseArguments(['inspect', '--', 'file', '--help'], false)).toMatchObject({ plan: { inputs: ['file', '--help'] } });
  });
  it.each(['inspect', 'group', 'report'])('recognizes functional %s', command => {
    expect(parseArguments([command], false).kind).toBe(command);
  });
});
