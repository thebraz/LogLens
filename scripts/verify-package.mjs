import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executableArchive } from './package-mode.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run through npm run verify:package so the matching npm CLI is used.');
const evidence = process.env.LOGLENS_EVIDENCE_DIR ?? path.join(root, 'evidence/stage-4');
const artifacts = path.join(root, 'artifacts');
await mkdir(evidence, { recursive: true }); await mkdir(artifacts, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const records = [];
const report = { status: 'FAIL', platform: process.platform, arch: process.arch, os: os.release(), node: process.version,
  npm: null, tarball: null, records };
function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 40 * 1024 ** 2, ...options });
  assert.equal(result.error, undefined, 'Subprocess must start and finish before its deadline.');
  assert.equal(result.signal, null, 'Subprocess must exit normally.');
  return result;
}
function npm(args, cwd = root) { return command(process.execPath, [npmCli, ...args], { cwd }); }
function checked(name, result, expected = 0) {
  records.push({ name, status: result.status === expected ? 'PASS' : 'FAIL', expectedExit: expected,
    actualExit: result.status, stdoutSha256: sha(result.stdout), stderrSha256: sha(result.stderr) });
  assert.equal(result.status, expected, name); return result;
}
async function files(directory, prefix = '') {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) output.push(...await files(path.join(directory, entry.name), name + '/'));
    else { assert.ok(entry.isFile(), 'Only regular build files may be packaged.'); output.push(name); }
  }
  return output.sort();
}
// The archive is generated locally and capped before decoding; validate real tar headers and bytes.
function unpack(bytes) {
  assert.ok(bytes.length < 4 * 1024 ** 2, 'Unexpected tarball growth.');
  const tar = gunzipSync(bytes, { maxOutputLength: 8 * 1024 ** 2 }); const entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512); if (header.every(byte => byte === 0)) break;
    const string = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/s, '');
    const name = string(0, 100); const prefix = string(345, 155);
    assert.equal(prefix, ''); assert.ok(name.startsWith('package/') && !name.split('/').includes('..'));
    assert.ok(header[156] === 0 || header[156] === 48, 'Only regular tar entries allowed.');
    const checksum = [...header].reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
    assert.equal(checksum, parseInt(string(148, 8), 8));
    const size = parseInt(string(124, 12), 8); const mode = parseInt(string(100, 8), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    assert.ok(!entries.has(name.slice(8)), 'Duplicate archive entry.');
    entries.set(name.slice(8), { bytes: tar.subarray(offset + 512, offset + 512 + size), mode });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}
let directory;
try {
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(metadata.type, 'module'); assert.equal(metadata.license, 'MIT');
  assert.equal(metadata.engines.node, '>=24 <25'); assert.deepEqual(metadata.bin, { loglens: 'dist/bin.js' });
  assert.deepEqual(metadata.dependencies ?? {}, {}); assert.deepEqual(metadata.optionalDependencies ?? {}, {});
  assert.equal(metadata.private, true, 'Publication remains explicitly locked.');
  assert.equal(metadata.gypfile, false, 'Consumer install must not invoke an implicit node-gyp hook.');
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack', 'prepublishOnly']) assert.equal(metadata.scripts[hook], undefined);
  const nativeFiles = (await files(path.join(root, 'native'))).filter(name => /^(win32-x64|linux-x64|darwin-arm64)\/(loglens_fs\.node|manifest\.json)$/.test(name));
  assert.ok(nativeFiles.includes(process.platform + '-' + process.arch + '/loglens_fs.node'), 'Current native backend must be packaged.');
  for (const name of nativeFiles.filter(name => name.endsWith('manifest.json'))) {
    const value = JSON.parse(await readFile(path.join(root, 'native', name), 'utf8'));
    assert.equal(value.sourceSha256, sha(await readFile(path.join(root, 'native/filesystem.cc'))), 'Stale native source manifest');
    assert.equal(value.buildConfigSha256, sha(await readFile(path.join(root, 'binding.gyp'))), 'Stale native build configuration');
    assert.equal(value.binarySha256, sha(await readFile(path.join(root, 'native', path.dirname(name), 'loglens_fs.node'))));
    assert.equal(value.nodeApi, 8);
  }
  const expectedFiles = ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/SUPPORTED_PLATFORMS.md', 'docs/USER_CONTRACT.md',
    'docs/RELEASE_NOTES.md', 'schemas/loglens.output.v1.schema.json', ...nativeFiles.map(name => 'native/' + name), ...(await files(path.join(root, 'dist'))).map(name => 'dist/' + name)].sort();
  assert.ok(expectedFiles.filter(name => name.startsWith('dist/')).every(name => name.endsWith('.js')));
  report.npm = checked('npm-version', npm(['--version'])).stdout.trim();
  const dry = JSON.parse(checked('pack-dry-run', npm(['pack', '--dry-run', '--json', '--ignore-scripts'])).stdout)[0];
  assert.deepEqual(dry.files.map(file => file.path).sort(), expectedFiles);
  const supplied = process.argv[2];
  const pack = supplied ? null : JSON.parse(checked('pack', npm(['pack', '--json', '--ignore-scripts', '--pack-destination', artifacts])).stdout)[0];
  const archive = supplied ? path.resolve(supplied) : path.join(artifacts, pack.filename);
  if (!supplied) await writeFile(archive, executableArchive(await readFile(archive)));
  const archiveBytes = await readFile(archive); const entries = unpack(archiveBytes);
  assert.deepEqual([...entries.keys()].sort(), expectedFiles);
  assert.ok(entries.get('dist/bin.js').bytes.toString().startsWith('#!/usr/bin/env node\n'));
  assert.ok((entries.get('dist/bin.js').mode & 0o111) !== 0, 'Executable tar permission required.');
  const suspicious = /[A-Za-z]:\\Users\\|\/home\/[A-Za-z0-9_-]+\/|(?:ghp_|github_pat_|sk-)[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
  for (const [name, entry] of entries) {
    assert.deepEqual(entry.bytes, await readFile(path.join(root, name)), 'Packed bytes differ: ' + name);
    assert.ok(!suspicious.test(entry.bytes.toString('utf8')), 'Sensitive-pattern/path candidate in ' + name);
  }
  report.tarball = { filename: path.basename(archive), sha256: sha(archiveBytes), size: archiveBytes.length,
    name: metadata.name, version: metadata.version, files: [...entries].map(([name, value]) => ({ name, size: value.bytes.length, sha256: sha(value.bytes), mode: value.mode })) };
  records.push({ name: 'archive-allowlist-bytes-mode-and-sensitive-patterns', status: 'PASS', files: entries.size,
    limitation: 'Pattern scan is not proof that arbitrary secrets or PII are absent.' });
  directory = await mkdtemp(path.join(os.tmpdir(), 'loglens-release-'));
  await writeFile(path.join(directory, 'package.json'), '{"name":"isolated-loglens-check","version":"1.0.0","private":true}\n');
  const npmFlags = ['--offline', '--no-audit', '--no-fund', '--package-lock=false', '--cache', path.join(directory, 'empty-cache')];
  checked('isolated-offline-install', npm(['install', ...npmFlags, archive], directory));
  const installed = path.join(directory, 'node_modules', ...metadata.name.split('/'));
  for (const [name, entry] of entries) assert.deepEqual(await readFile(path.join(installed, name)), entry.bytes, 'Installed bytes differ: ' + name);
  const shim = path.join(directory, 'node_modules/.bin/loglens' + (process.platform === 'win32' ? '.cmd' : ''));
  await access(shim);
  function cli(name, args, input = '', expected = 0) {
    let result;
    if (process.platform === 'win32') {
      // All shell arguments are generated by this harness; refuse cmd expansion/metacharacters.
      assert.ok([shim, ...args].every(value => /^[A-Za-z0-9_./\\:=,+ -]+$/.test(value)));
      const line = [shim, ...args].map(value => '"' + value + '"').join(' ');
      result = command(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', '"' + line + '"'], { cwd: directory, input, windowsVerbatimArguments: true });
    } else result = command(shim, args, { cwd: directory, input });
    return checked(name, result, expected);
  }
  const require = createRequire(import.meta.url); const Ajv = require('ajv');
  const validate = new Ajv({ allErrors: true }).compile(JSON.parse(await readFile(path.join(installed, 'schemas/loglens.output.v1.schema.json'), 'utf8')));
  function json(name, args, input = '', expected = 0) {
    const result = cli(name, [...args, '--output-format=json'], input, expected); const value = JSON.parse(result.stdout);
    assert.ok(validate(value), 'Packaged schema rejected ' + name);
    assert.equal(Object.values(value.summary.severity).reduce((a, b) => a + b, 0), value.stats.selectedEvents);
    assert.equal(value.summary.timedEvents + value.summary.untimedEvents, value.stats.selectedEvents);
    return value;
  }
  assert.match(cli('help', ['--help']).stdout, /inspect\|search\|group\|report/);
  assert.equal(cli('version', ['--version']).stdout, metadata.version + '\n');
  const fixture = [
    { time: 0, level: 'info', message: 'ready', requestId: 'r1', traceId: 't1' },
    { time: 1000, level: 'error', message: 'TypeError: failed account 123', stack: 'at execute (/app/api.js:10:2)', requestId: 'r1', traceId: 't1' },
    { time: 2000, level: 'error', message: 'TypeError: failed account 123', stack: 'at execute (/app/api.js:20:9)', requestId: 'r1', traceId: 't1' },
    { time: 3000, level: 'error', message: 'TypeError: failed account 456', stack: 'at execute (/app/api.js:10:2)', requestId: 'r2', traceId: 't2' },
    { time: 4000, level: 'fatal', message: 'TypeError: failed account 123', stack: 'at execute (/app/api.js:10:2)', requestId: 'r2', traceId: 't2' },
    { time: 5000, level: 'warn', message: 'retry', requestId: 'r2', traceId: 'r1', service: 'worker' },
    { message: 'untimed' }, { time: 6000, level: 'info', message: 'done', requestId: 'r1' }
  ].map(value => ({ service: 'api', logger: 'main', ...value }));
  const input = fixture.map(value => JSON.stringify(value)).join('\n') + '\n';
  await writeFile(path.join(directory, 'app.jsonl'), input); await writeFile(path.join(directory, 'copy.jsonl'), input);
  await writeFile(path.join(directory, 'archive.gz'), gzipSync(input));
  await writeFile(path.join(directory, 'concatenated.gz'), Buffer.concat([gzipSync(input), gzipSync(input)]));
  const inspect = json('structured-inspect', ['inspect', 'app.jsonl']);
  assert.equal(inspect.stats.eventsRead, 8); assert.equal(inspect.stats.damagedEvents, 0);
  assert.equal(inspect.summary.timedEvents, 7); assert.equal(inspect.summary.untimedEvents, 1);
  assert.deepEqual(inspect.summary.severity, { trace: 0, debug: 0, info: 2, warn: 1, error: 3, fatal: 1, unknown: 1 });
  const text = '1970-01-01T00:00:00Z INFO ready\nERROR TypeError: failed\n    at execute (/app/api.js:10:2)\nWARN retry\nraw text\n';
  await writeFile(path.join(directory, 'app.log'), text);
  const plain = json('plain-text-multiline', ['search', 'app.log', '--query=failed']);
  assert.equal(plain.stats.eventsRead, 4); assert.equal(plain.stats.physicalLines, 5);
  assert.deepEqual(plain.events[0].position, { lineStart: 2, lineEnd: 3, byteStart: Buffer.byteLength(text.split('\n')[0] + '\n'), byteEnd: Buffer.byteLength(text.split('\n').slice(0, 3).join('\n') + '\n') });
  assert.ok(plain.events[0].message.includes('\\u000a    at execute'));
  const filtered = json('multiple-filters-and-time-boundaries', ['search', 'app.jsonl', '--query=FAILED', '--ignore-case', '--level=error', '--service=api', '--id=request:r1', '--source=app.jsonl', '--since=1970-01-01T00:00:01Z', '--until=1970-01-01T00:00:03Z']);
  assert.equal(filtered.stats.matchedEvents, 2); assert.equal(filtered.stats.timeExcludedMissing, 1);
  assert.deepEqual(filtered.events.map(value => value.id), ['s000001:e2', 's000001:e3']);
  const context = json('context-display-limit', ['search', 'app.jsonl', '--query=failed', '--before=1', '--after=1', '--limit=1']);
  assert.equal(context.stats.matchedEvents, 4); assert.equal(context.stats.emittedMatches, 1); assert.equal(context.stats.contextEvents, 1);
  const grouped = json('fingerprint-groups', ['group', 'app.jsonl']);
  assert.deepEqual(grouped.groups.map(group => group.count), [2, 1, 1]);
  const tuple = ['loglens.fingerprint.v1', 'api', 'main', 'error', 'TypeError: failed account 123', 'TypeError', ['at execute (/app/api.js:<line>:<column>)'], null];
  assert.equal(grouped.groups[0].key, sha(JSON.stringify(tuple)));
  assert.deepEqual(json('fingerprint-repeat', ['group', 'app.jsonl']), grouped);
  const ids = json('request-correlation', ['group', 'app.jsonl', '--by=request-id']);
  assert.deepEqual(ids.groups.map(group => [group.value, group.count]), [['r1', 4], ['r2', 3]]); assert.equal(ids.analysis.uncorrelatedEvents, 1);
  assert.equal(json('severity-groups', ['group', 'app.jsonl', '--by=severity']).groups[0].count, 3);
  assert.deepEqual(json('source-groups', ['group', 'app.jsonl', 'copy.jsonl', '--by=source']).groups.map(group => group.count), [8, 8]);
  assert.equal(json('multiple-files', ['inspect', 'app.jsonl', 'copy.jsonl']).stats.eventsRead, 16);
  assert.equal(json('duplicate-path', ['inspect', 'app.jsonl', './app.jsonl']).stats.eventsRead, 8);
  for (const [name, args, bytes] of [['stdin', ['inspect', '-'], input], ['implicit-stdin', ['inspect'], input], ['gzip', ['inspect', 'archive.gz'], ''], ['gzip-stdin', ['inspect', '-'], gzipSync(input)]]) {
    assert.deepEqual(json(name, args, bytes).stats, inspect.stats);
  }
  assert.equal(json('concatenated-gzip', ['inspect', 'concatenated.gz']).stats.eventsRead, 16);
  const reportJson = json('json-report', ['report', 'app.jsonl', '--bucket=1m']);
  assert.deepEqual(reportJson.stats, inspect.stats); assert.equal(reportJson.timeline[0].count, 7);
  assert.deepEqual(reportJson.correlations.map(row => [row.kind, row.value, row.count]), [['request', 'r1', 4], ['request', 'r2', 3], ['trace', 't1', 3], ['trace', 't2', 2], ['trace', 'r1', 1]]);
  for (const format of ['json', 'html', 'markdown']) {
    cli(format + '-report-file', ['report', 'app.jsonl', '--output-format=' + format, '--output=incident.' + format]);
    const rendered = await readFile(path.join(directory, 'incident.' + format), 'utf8');
    if (format === 'json') { assert.ok(validate(JSON.parse(rendered))); assert.deepEqual(JSON.parse(rendered).stats, inspect.stats); }
    else { assert.ok(rendered.includes('LogLens report')); assert.ok(rendered.includes('failed account 456')); }
    await writeFile(path.join(evidence, 'report.' + format), rendered);
  }
  const ndjson = cli('ndjson-search', ['search', 'app.jsonl', '--query=failed', '--output-format=ndjson']).stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(ndjson.map(row => row.type), ['start', 'event', 'event', 'event', 'event', 'summary']); assert.equal(ndjson.at(-1).result.stats.matchedEvents, 4);
  assert.equal(json('no-match', ['search', 'app.jsonl', '--query=absent'], '', 1).stats.matchedEvents, 0);
  assert.equal(json('partial-input', ['inspect', '-'], '{"level":\nINFO safe\n', 3).stats.damagedEvents, 1);
  assert.equal(json('later-valid-source', ['inspect', 'missing.log', 'app.jsonl'], '', 3).stats.eventsRead, 8);
  assert.equal(json('missing-input', ['inspect', 'missing.log'], '', 4).sources[0].errors[0], 'INPUT_NOT_FOUND');
  cli('usage-error', ['search', '--unknown'], '', 2);
  await writeFile(path.join(directory, 'existing.json'), 'PRESERVE');
  cli('existing-output', ['inspect', 'app.jsonl', '--output=existing.json'], '', 4);
  assert.equal(await readFile(path.join(directory, 'existing.json'), 'utf8'), 'PRESERVE');
  cli('input-output-alias', ['inspect', 'app.jsonl', '--output=app.jsonl'], '', 4);
  cli('failed-input-no-commit', ['inspect', 'missing.log', '--output=missing-result.json'], '', 4);
  await assert.rejects(access(path.join(directory, 'missing-result.json')));
  const hostile = JSON.stringify({ level: 'error', message: 'hit password=CANARY_RELEASE_MSG </pre><script>evil()</script> ``` \u001b\u202e', token: ['CANARY_RELEASE_ATTR'], requestId: 'secret=CANARY_RELEASE_ID' }) + '\n';
  for (const [kind, format] of [['search', 'text'], ['search', 'json'], ['search', 'ndjson'], ['group', 'json'], ['report', 'html'], ['report', 'markdown'], ['report', 'json']]) {
    const args = [kind, '-', '--output-format=' + format, ...(kind === 'search' ? ['--query=hit', ...(format === 'text' ? [] : ['--include-raw'])] : [])];
    const rendered = cli('protection-' + kind + '-' + format, args, hostile);
    assert.ok(!(rendered.stdout + rendered.stderr).includes('CANARY_RELEASE_'));
    assert.ok(!rendered.stdout.includes('\u001b')); assert.ok(!rendered.stdout.includes('\u202e'));
    if (format === 'html') { assert.ok(!/<script|onerror=|href=|src=/i.test(rendered.stdout)); assert.ok(rendered.stdout.includes('&lt;script&gt;')); }
  }
  const protectedRaw = json('protected-raw-hash', ['search', '-', '--query=hit', '--include-raw'], hostile);
  assert.equal(protectedRaw.events[0].raw.sha256, null);
  cli('unpaired-sensitive-flag', ['search', '-', '--query=hit', '--no-redact'], hostile, 2);
  const sensitive = json('paired-sensitive-flags', ['search', '-', '--query=hit', '--include-raw', '--no-redact', '--ack-sensitive-output'], hostile);
  assert.ok(sensitive.events[0].message.includes('CANARY_RELEASE_MSG')); assert.match(sensitive.events[0].raw.sha256, /^[a-f0-9]{64}$/);
  if (process.platform === 'win32') {
    const ps = path.join(directory, 'check.ps1');
    await writeFile(ps, `$ErrorActionPreference = 'Stop'\n$bin = Join-Path $PSScriptRoot 'node_modules/.bin/loglens.cmd'\n$actual = & $bin --version\nif ($LASTEXITCODE -ne 0 -or $actual -ne '${metadata.version}') { throw 'Version failed' }\n'{"level":"info","message":"ação 漢字"}' | & $bin inspect - --output-format=json --output=powershell.json\nif ($LASTEXITCODE -ne 0) { throw 'Pipeline failed' }\n$value = Get-Content -LiteralPath powershell.json -Raw | ConvertFrom-Json\nif ($value.stats.eventsRead -ne 1 -or $value.summary.severity.info -ne 1) { throw 'Counts failed' }\n`);
    checked('actual-powershell-installed-shim', command('pwsh', ['-NoProfile', '-NonInteractive', '-File', ps], { cwd: directory }));
  } else assert.ok(((await stat(path.join(installed, 'dist/bin.js'))).mode & 0o111) !== 0);
  assert.equal(await readFile(path.join(directory, 'app.jsonl'), 'utf8'), input);
  assert.equal(await readFile(path.join(directory, 'copy.jsonl'), 'utf8'), input);
  assert.ok(!(await readdir(directory)).some(name => name.startsWith('.loglens-') && name.endsWith('.tmp')));
  records.push({ name: 'inputs-unchanged-and-no-temporary-residue', status: 'PASS' });
  const nativePath = path.join(installed, 'native', process.platform + '-' + process.arch, 'loglens_fs.node');
  await rename(nativePath, nativePath + '.held');
  try {
    const missing = cli('missing-native-fails-closed', ['inspect', 'app.jsonl', '--output-format=json'], '', 2);
    assert.equal(missing.stdout, ''); assert.ok(missing.stderr.includes('NOT_AVAILABLE'));
    const unavailable = cli('missing-native-output-fails-closed', ['inspect', '-', '--output=unavailable.json'], input, 2);
    assert.ok(unavailable.stderr.includes('NOT_AVAILABLE')); await assert.rejects(access(path.join(directory, 'unavailable.json')));
    assert.equal(json('stdin-without-native', ['inspect', '-'], input).stats.eventsRead, 8);
    await writeFile(nativePath, 'invalid native image');
    const invalid = cli('incompatible-native-fails-closed', ['inspect', 'app.jsonl', '--output-format=json'], '', 2);
    assert.equal(invalid.stdout, ''); assert.ok(invalid.stderr.includes('NOT_AVAILABLE'));
    await rm(nativePath);
  } finally { await rename(nativePath + '.held', nativePath); }
  assert.deepEqual(await readFile(nativePath), entries.get('native/' + process.platform + '-' + process.arch + '/loglens_fs.node').bytes);
  checked('offline-uninstall', npm(['uninstall', ...npmFlags, metadata.name], directory));
  await assert.rejects(access(shim)); await assert.rejects(access(installed));
  report.status = 'PASS';
} catch (failure) {
  report.failure = failure instanceof Error ? failure.message.split('\n')[0] : 'Unknown verification failure';
  process.exitCode = 1;
} finally {
  if (directory) {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('loglens-release-'));
    await rm(directory, { recursive: true, force: true });
  }
  await writeFile(path.join(evidence, 'package-verification.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ status: report.status, checks: records.length, tarball: report.tarball?.filename,
    sha256: report.tarball?.sha256, failure: report.failure ?? null }) + '\n');
}
