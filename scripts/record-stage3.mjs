import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
const paths = [];
const evidence = process.env.LOGLENS_EVIDENCE_DIR ?? 'evidence/stage-3';
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file); else if (entry.isFile() && !file.endsWith('AUDIT_REPORT.md')) paths.push(file);
  }
}
for (const directory of ['src', 'dist', 'tests', 'scripts', 'benchmarks', 'schemas', 'docs']) await walk(directory);
paths.push('AGENTS.md', 'README.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'eslint.config.js');
const files = [];
for (const file of [...new Set(paths)].sort()) {
  const bytes = await readFile(file); files.push({ path: file.replaceAll(path.sep, '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const manifest = JSON.stringify({ algorithm: 'sha256', exclusions: ['docs/AUDIT_REPORT.md: report contains manifest identity', 'evidence/**: measurement results, not compiled source'], files }, null, 2) + '\n';
const digest = createHash('sha256').update(manifest).digest('hex');
await writeFile(path.join(evidence, 'build-manifest.json'), manifest); await writeFile(path.join(evidence, 'build-manifest.sha256'), digest + '\n');
let references = 0;
for (const file of ['AGENTS.md', 'README.md', ...paths.filter(p => p.startsWith('docs' + path.sep) && p.endsWith('.md')), 'docs/AUDIT_REPORT.md']) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const value = match[1]; if (/^(?:[a-z]+:|#)/i.test(value)) continue;
    const local = value.split('#')[0]; if (!local) continue;
    const target = path.resolve(path.dirname(file), decodeURIComponent(local));
    if (target !== path.resolve(evidence, 'artifact-verification.json')) await access(target);
    references++;
  }
}
for (const row of files) assert.equal(createHash('sha256').update(await readFile(row.path)).digest('hex'), row.sha256);
await writeFile(path.join(evidence, 'artifact-verification.json'), JSON.stringify({ status: 'PASS', manifestSha256: digest, files: files.length, localReferences: references }, null, 2) + '\n');
await access(path.join(evidence, 'artifact-verification.json'));
process.stdout.write(JSON.stringify({ status: 'PASS', manifestSha256: digest, files: files.length, localReferences: references }) + '\n');
