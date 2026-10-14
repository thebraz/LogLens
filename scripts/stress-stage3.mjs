import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const directory = await mkdtemp(path.join(os.tmpdir(), 'loglens-stress-audit-')); const results = [];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function run(name, input, args, expectedStatus, oracle) {
  const file = path.join(directory, `${name}.log`); const output = path.join(directory, `${name}.out`); const metrics = path.join(directory, `${name}.metrics`);
  await writeFile(file, input); const start = performance.now();
  const child = spawnSync(process.execPath, [path.join(root, 'benchmarks/measure.mjs'), metrics, path.join(root, 'dist/bin.js'), ...args, file, '--output', output],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 ** 2 });
  if (child.error) throw child.error;
  assert.equal(child.status, expectedStatus); assert.equal(child.stdout, ''); assert.equal(sha(await readFile(file)), sha(input));
  const memory = JSON.parse(await readFile(metrics, 'utf8')); const exists = (await readdir(directory)).includes(path.basename(output));
  if (expectedStatus === 4) { assert.equal(exists, false); assert.ok(child.stderr.includes('OUTPUT_LIMIT')); }
  else { const rendered = await readFile(output, 'utf8'); await oracle(args.includes('--output-format=html') ? rendered : JSON.parse(rendered)); }
  assert.equal((await readdir(directory)).filter(x => x.endsWith('.tmp')).length, 0);
  const row = { name, status: 'PASS', exitCode: child.status, bytes: Buffer.byteLength(input), seconds: (performance.now() - start) / 1000,
    peakRssMiB: memory.maxRssKiB / 1024, inputSha256: sha(input), noInputMutation: true, noTemporaryResidue: true, outputCommitted: exists };
  results.push(row); process.stdout.write(JSON.stringify(row) + '\n');
}
try {
  let input = '';
  for (let n = 0; n < 10001; n++) input += JSON.stringify({ level: 'error', message: 'Error: same common', time: n * 60000, requestId: `r${n}` }) + '\n';
  input += '{"level":"error","message":"Error: same common","time":0,"requestId":"r0"}\n';
  await run('ids-timeline', input, ['report', '--output-format=json', '--top=10000', '--bucket=1m'], 3, async result => {
    assert.equal(result.stats.eventsRead, 10002); assert.equal(result.groups.length, 1); assert.equal(result.groups[0].count, 10002);
    assert.equal(result.correlations.length, 10000); assert.equal(result.correlations[0].count, 2); assert.equal(result.analysis.overflowCorrelationMemberships, 1);
    assert.equal(result.timeline.length, 10000); assert.equal(result.timeline[0].count, 2); assert.equal(result.analysis.overflowTimelineEvents, 1);
    assert.equal(result.timeline.reduce((n, b) => n + b.count, 0) + result.analysis.overflowTimelineEvents, 10002);
  });
  await run('broad-context', input, ['search', '--query=common', '--before=100', '--after=100', '--limit=1', '--output-format=json'], 0, async result => {
    assert.equal(result.stats.matchedEvents, 10002); assert.equal(result.stats.emittedMatches, 1); assert.equal(result.stats.contextEvents, 0);
    assert.equal(result.events.length, 1); assert.equal(result.analysis.displayTruncated, true); assert.equal(result.coverage, 'complete');
  });
  let amplified = '';
  let accepted = '';
  for (let n = 0; n < 800; n++) accepted += JSON.stringify({ level: 'error', message: `${n} ` + '&'.repeat(15000) }) + '\n';
  await run('html-large-accepted', accepted, ['report', '--output-format=html', '--top=10000'], 0, async output => {
    assert.ok(Buffer.byteLength(output) <= 32 * 1024 ** 2); assert.ok(output.includes('Events read: 800')); assert.ok(output.includes('&amp;'));
    assert.ok(output.endsWith('</body></html>\n')); assert.ok(!output.includes('<script'));
  });
  for (let n = 0; n < 1200; n++) amplified += JSON.stringify({ level: 'error', message: `${n} ` + '&'.repeat(15000) }) + '\n';
  await run('html-expansion-cap', amplified, ['report', '--output-format=html', '--top=10000'], 4);
  const memoryPass = results.every(r => r.peakRssMiB <= 512);
  await writeFile(process.env.LOGLENS_EVIDENCE_DIR ? path.join(process.env.LOGLENS_EVIDENCE_DIR, 'resource-stress.json') : new URL('../evidence/stage-3/resource-stress.json', import.meta.url), JSON.stringify({ status: memoryPass ? 'PASS' : 'FAIL', node: process.version,
    platform: process.platform, condition: 'Shared Windows desktop; one controlled correctness/memory run per workload, not reference medians', results }, null, 2) + '\n');
  assert.ok(memoryPass, 'Adversarial peak RSS exceeded the recorded local 512-MiB gate');
} finally {
  const target = path.resolve(directory); assert.equal(path.dirname(target), path.resolve(os.tmpdir())); assert.ok(path.basename(target).startsWith('loglens-stress-audit-'));
  await rm(target, { recursive: true, force: true });
}
