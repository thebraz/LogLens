import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmod, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createFileSink } from '../src/io/sink.js';
import { openInput } from '../src/io/paths.js';
import { nativeOutput } from '../src/io/native.js';
import { renameSync, symlinkSync, unlinkSync, fstatSync } from 'node:fs';

const bin = path.resolve('dist/bin.js'); const audit = path.resolve('scripts/audit-filesystem-race.mjs');
let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'loglens-filesystem-control-')); });
afterEach(async () => {
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir())); expect(path.basename(directory)).toMatch(/^loglens-filesystem-control-/);
  await rm(directory, { recursive: true, force: true });
});
function subprocess(script: string, args: string[]) {
  const child = spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, LOGLENS_EVIDENCE_DIR: directory } });
  expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); return child;
}
describe('filesystem gate mechanics and legitimate controls (not confinement acceptance)', () => {
  it.skipIf(process.platform !== 'win32').each(['NUL', 'aux.log', 'COM1.txt', 'CONOUT$', 'LPT²', 'input.log:stream'])('rejects Windows device/stream namespace %s without creating files', async name => {
    const target = path.join(directory, name);
    await expect(openInput(target)).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(createFileSink(target, '-')).rejects.toMatchObject({ code: 'UNSAFE_OUTPUT' });
    expect(await readdir(directory)).toEqual([]);
  });
  it.skipIf(process.platform !== 'win32')('preserves a foreign temp-name collision and reports UNSAFE_OUTPUT', async () => {
    const name = '.loglens-collision.tmp'; const target = path.join(directory, 'never.json');
    await writeFile(path.join(directory, name), 'foreign');
    try { nativeOutput(target, name); throw new Error('Expected exclusive creation rejection'); }
    catch (error) { expect(error).toMatchObject({ code: 'UNSAFE_OUTPUT' }); }
    expect(await readdir(directory)).toEqual([name]); expect(await readFile(path.join(directory, name), 'utf8')).toBe('foreign');
  });
  it('cleans its own file and retained ancestors if native setup fails after creation', async () => {
    let injected = false;
    await expect(createFileSink(path.join(directory, 'never.json'), '-', { create: stage => {
      if (stage === 'after-open') { injected = true; throw new Error('Synthetic setup failure'); }
    } })).rejects.toMatchObject({ code: 'UNSAFE_OUTPUT' });
    expect(injected).toBe(true); expect(await readdir(directory)).toEqual([]);
    const moved = directory + '-moved'; renameSync(directory, moved); renameSync(moved, directory);
  });
  it('rejects a junction injected during native traversal before acquiring that component', async () => {
    const selected = path.join(directory, 'selected'); const moved = path.join(directory, 'moved'); const foreign = path.join(directory, 'foreign');
    await mkdir(selected); await mkdir(foreign);
    await writeFile(path.join(selected, 'input.log'), 'INFO selected'); await writeFile(path.join(foreign, 'input.log'), 'INFO foreign');
    let injected = false;
    try {
      await expect(openInput(path.join(selected, 'input.log'), (stage, component) => {
        if (stage !== 'before-component' || component !== 'selected') return;
        renameSync(selected, moved); symlinkSync(foreign, selected, process.platform === 'win32' ? 'junction' : 'dir'); injected = true;
      })).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
      expect(injected).toBe(true); expect(await readFile(path.join(foreign, 'input.log'), 'utf8')).toBe('INFO foreign');
    } finally { if (injected) { unlinkSync(selected); renameSync(moved, selected); } }
    expect(await readFile(path.join(selected, 'input.log'), 'utf8')).toBe('INFO selected');
  });
  it('preserves an existing reparse destination as OUTPUT_EXISTS', async () => {
    const target = path.join(directory, 'existing'); const real = path.join(directory, 'real'); await mkdir(real);
    await symlink(real, target, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(createFileSink(target, '-')).rejects.toMatchObject({ code: 'OUTPUT_EXISTS' });
    expect(await readdir(real)).toEqual([]);
  });
  it('preserves an existing directory as OUTPUT_EXISTS', async () => {
    const target = path.join(directory, 'existing'); await mkdir(target);
    await expect(createFileSink(target, '-')).rejects.toMatchObject({ code: 'OUTPUT_EXISTS' });
    expect(await readdir(target)).toEqual([]);
  });
  it.skipIf(process.platform !== 'win32')('discards its own Windows temporary even if its read-only attribute is changed', async () => {
    const sink = await createFileSink(path.join(directory, 'readonly.json'), '-');
    try {
      const name = (await readdir(directory)).find(value => value.endsWith('.tmp'));
      if (!name) throw new Error('Missing owned temporary');
      await chmod(path.join(directory, name), 0o444);
    } finally { await sink.discard(); }
    expect(await readdir(directory)).toEqual([]);
  });
  it.skipIf(process.platform !== 'win32')('preserves the raced winner and cleans a read-only owned temporary after failed commit', async () => {
    const target = path.join(directory, 'winner.json'); const sink = await createFileSink(target, '-');
    try {
      await sink.write('owned', new AbortController().signal);
      const name = (await readdir(directory)).find(value => value.endsWith('.tmp')); if (!name) throw new Error('Missing owned temporary');
      await chmod(path.join(directory, name), 0o444); await writeFile(target, 'winner');
      await expect(sink.commit(new AbortController().signal)).rejects.toMatchObject({ code: 'OUTPUT_EXISTS' });
    } finally { await sink.discard(); }
    expect(await readdir(directory)).toEqual(['winner.json']); expect(await readFile(target, 'utf8')).toBe('winner');
  });
  it.skipIf(process.platform !== 'linux')('uses an unnamed mode0600 Linux output inode and removes it by close', async () => {
    const { lease, api } = nativeOutput(path.join(directory, 'never.json'), '.loglens-unused.tmp');
    try { expect(fstatSync(lease.fd).mode & 0o777).toBe(0o600); expect(await readdir(directory)).toEqual([]); }
    finally { api.close(lease.token); }
    expect(await readdir(directory)).toEqual([]);
  });
  it('standalone gate returns zero only for the exercised legitimate control', () => {
    const child = subprocess(audit, ['controls']); expect(child.status).toBe(0); expect(child.stderr).toBe('');
    expect(JSON.parse(child.stdout)).toMatchObject({ status: 'PASS', exitCode: 0, records: [{ name: 'controls', noInputMutation: true, noTemporaryResidue: true }] });
  });
  it('unknown scenarios are errors rather than skipped or passing security checks', () => {
    const child = subprocess(audit, ['invalid-case']); expect(child.status).toBe(2);
    expect(JSON.parse(child.stdout)).toMatchObject({ status: 'ERROR', exitCode: 2, records: [{ status: 'ERROR' }] });
  });
  it('maps violations to exit 1 and infrastructure errors to exit 2 without empty-gate success', () => {
    const script = `import assert from 'node:assert/strict'; import {gateExitCode} from ${JSON.stringify(new URL('../scripts/filesystem-cases.mjs', import.meta.url).href)};
      assert.equal(gateExitCode([{status:'PASS'}]),0); assert.equal(gateExitCode([{status:'PASS'},{status:'FAIL'}]),1);
      assert.equal(gateExitCode([{status:'FAIL'},{status:'ERROR'}]),2); assert.throws(()=>gateExitCode([]));
      assert.throws(()=>gateExitCode([{status:'SKIP'}]));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 5000 });
    expect(child.error).toBeUndefined(); expect(child.status).toBe(0); expect(child.stderr).toBe('');
  });
  it.each(['file', 'dir'] as const)('rejects a real ordinary %s symbolic link without reading a canary', async type => {
    const real = path.join(directory, 'real'); await mkdir(real); const input = path.join(real, 'input.log');
    await writeFile(input, 'INFO SYNTHETIC_LINK_CANARY\n'); const alias = path.join(directory, 'alias');
    await symlink(type === 'file' ? input : real, alias, type);
    const child = subprocess(bin, ['search', type === 'file' ? alias : path.join(alias, 'input.log'), '--query=SYNTHETIC_LINK_CANARY', '--output-format=json']);
    expect(child.status).toBe(4); expect(child.stdout + child.stderr).not.toContain('SYNTHETIC_LINK_CANARY');
    expect(JSON.parse(child.stdout)).toMatchObject({ stats: { eventsRead: 0, bytesRead: 0 }, sources: [{ errors: ['UNSAFE_PATH'], status: 'failed' }] });
    await expect(createFileSink(path.join(alias, 'output.json'), '-')).rejects.toMatchObject({ code: 'UNSAFE_OUTPUT' });
    expect(await readdir(real)).toEqual(['input.log']);
  });
  it('preserves a hard-linked input destination and its bytes', async () => {
    const input = path.join(directory, 'input.log'); const output = path.join(directory, 'output.json');
    await writeFile(input, 'INFO original\n'); await link(input, output);
    await expect(createFileSink(output, input)).rejects.toMatchObject({ code: 'OUTPUT_EXISTS' });
    expect(await readFile(input, 'utf8')).toBe('INFO original\n'); expect(await readFile(output, 'utf8')).toBe('INFO original\n');
    expect((await readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });
});
