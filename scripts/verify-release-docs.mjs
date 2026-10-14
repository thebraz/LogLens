import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(metadata.version, '0.1.0-beta.1'); assert.equal(metadata.private, true);
assert.equal(metadata.gypfile, false);
for (const file of ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/SUPPORTED_PLATFORMS.md', 'docs/USER_CONTRACT.md', 'docs/RELEASE_NOTES.md', 'docs/STAGE_4_ACCEPTANCE.md', 'docs/WINDOWS_BETA_ACCEPTANCE.md']) {
  const source = await readFile(file, 'utf8');
  assert.ok(source.includes('0.1.0-beta.1'), 'Version missing: ' + file);
  assert.match(source, /PARTIAL|BLOCKED|experimental|bloquead|não.*pront|NOT READY/i, 'Readiness must remain explicit: ' + file);
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1]; if (/^[a-z]+:|^#|^\//i.test(href)) continue;
    await access(path.resolve(path.dirname(file), href.split('#')[0]));
  }
}
assert.ok(!metadata.scripts.install && !metadata.scripts.postinstall && !metadata.scripts.prepare);
assert.equal(metadata.repository.url, 'git+https://github.com/thebraz/LogLens.git');
assert.equal(metadata.bugs.url, 'https://github.com/thebraz/LogLens/issues');
assert.match(await readFile('docs/STAGE_4_ACCEPTANCE.md', 'utf8'), /^# Stage 4.*PARTIAL/);
for (const file of ['README.md', 'docs/RELEASE_NOTES.md', 'docs/SUPPORTED_PLATFORMS.md']) {
  const source = await readFile(file, 'utf8');
  assert.match(source, /Windows/); assert.match(source, /Node(?:\.js)?\s*24/);
  assert.match(source, /Linux/); assert.match(source, /macOS/);
  assert.match(source, /not (?:validated|supported)|unsupported/i);
  assert.match(source, /npm.*(?:not|unpublished)|npm readiness/i);
}
console.log(JSON.stringify({ status: 'PASS', version: metadata.version, checks: 'version, explicit blockers, links, publication lock, no install hooks' }));
