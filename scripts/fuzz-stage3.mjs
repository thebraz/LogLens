import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as pause } from 'node:timers/promises';
import { frameLines } from '../dist/io/framing.js';
import { parseRecords } from '../dist/core/records.js';
import { createAnalysis } from '../dist/core/analysis.js';
import { fingerprint } from '../dist/core/fingerprint.js';
import { canonical } from '../dist/core/json.js';
import { parseArguments } from '../dist/cli/args.js';
import { project, protectedValue } from '../dist/output/project.js';

const family = process.argv[2]; const minutes = Number(process.argv[3] ?? 30);
const batchLimit = process.argv[4] === undefined ? null : Number(process.argv[4]);
const evidenceSuffix = process.argv[5] ?? '';
assert.match(evidenceSuffix, /^(?:-[a-z0-9-]+)?$/);
assert.ok(['jsonl', 'text'].includes(family)); assert.ok(Number.isFinite(minutes) && minutes > 0 && minutes <= 60);
assert.ok(batchLimit === null || (Number.isSafeInteger(batchLimit) && batchLimit > 0));
const source = { id: 's000001', label: 'synthetic.log', kind: 'file' };
const seed = family === 'jsonl' ? 0x31013026 : 0x32013026; let state = seed;
const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
const action = parseArguments(['report', '-', '--top=10000', '--bucket=1m'], false);
assert.ok('plan' in action); const plan = action.plan;
const start = performance.now(); let batches = 0; let records = 0; let bytes = 0; let lastCheckpoint = start;
const digest = createHash('sha256'); const resultDigest = createHash('sha256');
const evidencePath = new URL(`../evidence/stage-3/fuzz-${family}${evidenceSuffix}.json`, import.meta.url);
async function parse(input, split) {
  async function* chunks() {
    for (let offset = 0; offset < input.length;) { const length = split ? 1 + random() % 1024 : 65536; yield input.subarray(offset, offset + length); offset += length; }
  }
  const progress = { bytesRead: 0, physicalLines: 0 }; let blanks = 0; const events = [];
  for await (const event of parseRecords(frameLines(chunks(), progress, new AbortController().signal), source,
    { format: family === 'jsonl' ? 'jsonl' : 'auto', assumeTimezone: null }, () => { blanks++; })) events.push(event);
  return { events, progress, blanks };
}
function generate() {
  const pieces = []; const expected = []; const count = 32;
  if (random() % 2 === 0) pieces.push(Buffer.from('\uFEFF'));
  for (let i = 0; i < count; i++) {
    const n = random(); const level = ['info', 'error', 'fatal', 'warn', 'unknown'][n % 5];
    let body; const newline = n % 2 ? '\r\n' : '\n';
    if (family === 'jsonl') {
      const value = { time: n % 4 ? n % 120001 - 60000 : null, level, message: `event ${n % 12} ação 😀\0`, requestId: `r${n % 7}`,
        traceId: n % 3 ? `t${n % 5}` : null, token: ['CANARY_FUZZ_A', { safe: 'CANARY_FUZZ_B' }], extra: { n: n % 100 } };
      body = JSON.stringify(value);
      if (n % 17 === 0) body = '{"message":';
      else if (n % 19 === 0) body = '{"message":"ok","level":"error","extra":' + '[ '.repeat(34) + '0' + ']'.repeat(34) + '}';
      else if (n % 23 === 0) body = '{"message":"ok","__proto__":{"polluted":true}}';
      else if (n % 29 === 0) body = '{"message":false,"msg":"other","timestamp":"2026-02-30T00:00:00+14:01"}';
      else if (n % 31 === 0) body = '{"message":"\\ud800","n":1e400}';
      expected.push(null);
    } else {
      const header = level === 'unknown' ? '[UNKNOWN]' : level.toUpperCase();
      body = `${header} TypeError: event ${n % 12} password=CANARY_FUZZ_A`;
      if (n % 3 === 0) body += newline + '  at run (ação.js:123:45)' + newline + 'Caused by: OtherError: detail';
      if (n % 7 === 0) body += newline + '  [incomplete header';
      expected.push(level);
    }
    pieces.push(Buffer.from(body + (i === count - 1 && n % 2 ? '' : newline)));
  }
  return { input: Buffer.concat(pieces), expected };
}
async function checkpoint(status, error = null) {
  const seconds = (performance.now() - start) / 1000;
  const evidence = { status, family, seed: `0x${seed.toString(16)}`, finalState: state >>> 0, node: process.version, platform: process.platform,
    minutesRequested: minutes, seconds, batches, generatedRecords: records, generatedBytes: bytes,
    datasetSha256: digest.copy().digest('hex'), resultSha256: resultDigest.copy().digest('hex'), peakRssMiB: process.resourceUsage().maxRSS / 1024,
    properties: ['random chunk partition invariance', 'known event accounting', 'raw byte/hash/line provenance', 'ordinal stability', 'severity conservation',
      'time/timeline conservation', 'fingerprint determinism', 'valid canonical serialization', 'no prototype mutation', 'raw and structured canary protection'],
    limitations: 'Bounded generated corpus; deterministic seed plus final PRNG state and elapsed budget. Not exhaustive parser proof. CPU shared with other audit checks.', error };
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ status, family, seconds, records, batches }) + '\n');
}
try {
  do {
    const { input, expected } = generate(); const whole = await parse(input, false); const split = await parse(input, true);
    const comparable = value => ({ ...value, events: value.events.map(e => ({ ...e, codes: [...e.codes].sort() })) });
    assert.equal(canonical(comparable(whole)), canonical(comparable(split))); assert.equal(whole.events.length, expected.length);
    assert.equal(whole.progress.bytesRead, input.length); assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
    const analysis = createAnalysis(plan, (e, m, r) => project(e, m, true, false, r), v => protectedValue(v, true));
    const outcome = { ...source, status: 'complete', bytesRead: 0, eventsRead: 0, damagedEvents: 0, errors: [] };
    let previousEnd = 0;
    for (let i = 0; i < whole.events.length; i++) {
      const parsed = whole.events[i]; const event = parsed.event; const position = event.position;
      assert.equal(event.id, `s000001:e${i + 1}`); assert.ok(position.byteStart >= previousEnd); previousEnd = position.byteEnd;
      assert.equal(event.raw.byteLength, position.byteEnd - position.byteStart);
      assert.equal(event.raw.sha256, createHash('sha256').update(input.subarray(position.byteStart, position.byteEnd)).digest('hex'));
      if (expected[i] !== null) assert.equal(event.severity, expected[i]);
      assert.equal(fingerprint(parsed), fingerprint(split.events[i]));
      const projection = canonical(project(event, 'match', true, true)); assert.ok(!projection.includes('CANARY_FUZZ_')); JSON.parse(projection);
      analysis.accept(parsed, outcome);
    }
    const result = analysis.finish(); assert.equal(result.stats.eventsRead, expected.length);
    assert.equal(Object.values(result.summary.severity).reduce((a, b) => a + b, 0), expected.length);
    assert.equal(result.summary.timedEvents + result.summary.untimedEvents, expected.length);
    assert.equal(result.timeline.reduce((n, b) => n + b.count, 0) + result.analysis.overflowTimelineEvents, result.summary.timedEvents);
    assert.equal(result.groups.reduce((n, g) => n + g.count, 0) + result.analysis.overflowGroupEvents + result.analysis.ungroupableEvents,
      result.summary.severity.error + result.summary.severity.fatal);
    assert.ok(analysis.retainedBytes() <= 64 * 1024 ** 2);
    batches++; records += expected.length; bytes += input.length; digest.update(input); resultDigest.update(canonical(result));
    if (performance.now() - lastCheckpoint > 30000) { await checkpoint('RUNNING'); lastCheckpoint = performance.now(); }
    await pause(batchLimit === null ? 20 : 0);
  } while (batchLimit === null ? performance.now() - start < minutes * 60000 || records < 100000 : batches < batchLimit);
  await checkpoint('PASS');
} catch (error) {
  await checkpoint('FAIL', error instanceof Error ? error.message : 'Unknown assertion'); throw error;
}
