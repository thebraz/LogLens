import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { renameSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openInput, systemCode } from '../dist/io/paths.js';
import { createFileSink } from '../dist/io/sink.js';

const selectedBytes = 'INFO selected\n'; const foreignBytes = 'INFO SYNTHETIC_UNSELECTED\n';
const ownedBytes = 'owned report\n'; const replacementBytes = 'synthetic replacement\n';
const signal = () => new AbortController().signal;
const redirect = (from, to) => fs.symlink(to, from, process.platform === 'win32' ? 'junction' : 'dir');
async function fixtureBytes(opened) {
  assert.ok(opened.size <= 256, 'Only bounded synthetic fixtures in audit helper');
  const buffer = Buffer.alloc(opened.size); let position = 0;
  while (position < buffer.length) {
    const { bytesRead } = await opened.handle.read(buffer, position, buffer.length - position, position);
    assert.ok(bytesRead > 0); position += bytesRead;
  }
  return buffer.toString('utf8');
}
async function exists(file) {
  try { await fs.lstat(file); return true; } catch (error) { if (systemCode(error) === 'ENOENT') return false; throw error; }
}
function attack(operation) {
  try { operation(); return null; }
  catch (error) { if (!['EBUSY', 'EPERM', 'EACCES'].includes(systemCode(error))) throw error; return systemCode(error); }
}
function requireInjection(value, message) {
  if (!value) { const failure = new Error(message); failure.code = 'AUDIT_INJECTION'; throw failure; }
}
async function setup(directory) {
  const parent = path.join(directory, 'selected'); const moved = path.join(directory, 'moved'); const victim = path.join(directory, 'victim');
  await fs.mkdir(parent); await fs.mkdir(victim);
  await fs.writeFile(path.join(parent, 'input.log'), selectedBytes); await fs.writeFile(path.join(victim, 'input.log'), foreignBytes);
  // Prove rename + junction injection really works in this same fixture, before
  // protection is acquired. A later EPERM alone is never a security PASS.
  await fs.rename(parent, moved); await redirect(parent, victim);
  assert.equal(await fs.readFile(path.join(parent, 'input.log'), 'utf8'), foreignBytes);
  await fs.unlink(parent); await fs.rename(moved, parent);
  return { parent, moved, victim, baselineInjectionExecuted: true };
}
async function controls(directory) {
  const input = path.join(directory, 'input.log'); await fs.writeFile(input, selectedBytes);
  const opened = await openInput(input);
  try { assert.equal(await fixtureBytes(opened), selectedBytes); } finally { await opened.handle.close(); }
  const target = path.join(directory, 'result.json'); const sink = await createFileSink(target, input);
  try { await sink.write(ownedBytes, signal()); await sink.commit(signal()); } finally { await sink.discard(); }
  assert.equal(await fs.readFile(target, 'utf8'), ownedBytes); assert.equal(await fs.readFile(input, 'utf8'), selectedBytes);
  const raced = path.join(directory, 'raced.json'); const other = await createFileSink(raced, input);
  try { await other.write(ownedBytes, signal()); await fs.writeFile(raced, replacementBytes);
    await assert.rejects(other.commit(signal()), { code: 'OUTPUT_EXISTS' }); } finally { await other.discard(); }
  assert.equal(await fs.readFile(raced, 'utf8'), replacementBytes);
  assert.equal((await fs.readdir(directory)).filter(name => name.endsWith('.tmp')).length, 0);
  return { status: 'PASS', noInputMutation: true, noTemporaryResidue: true };
}
async function inputRace(directory) {
  const f = await setup(directory); let swapped = false; let injected = false; let denied = null;
  const opened = await openInput(path.join(f.parent, 'input.log'), stage => {
    if (stage !== 'before-leaf') return;
    injected = true; denied = attack(() => renameSync(f.parent, f.moved));
    if (denied === null) { symlinkSync(f.victim, f.parent, process.platform === 'win32' ? 'junction' : 'dir'); swapped = true; }
  });
  try {
    requireInjection(injected, 'Native before-leaf boundary was not exercised');
    const content = await fixtureBytes(opened); assert.equal(content, selectedBytes);
    return { status: 'PASS', finding: 'LL-008', injected: true, baselineInjectionExecuted: true,
      protectedAttackAttempted: true, observedDenial: denied, unsafeRead: false, selectedBytesVerified: true };
  } finally {
    await opened.handle.close(); if (swapped) { await fs.unlink(f.parent); await fs.rename(f.moved, f.parent); }
    // The operation becomes available after the lease is released.
    await fs.rename(f.parent, f.moved); await fs.rename(f.moved, f.parent);
    assert.equal(await fs.readFile(path.join(f.victim, 'input.log'), 'utf8'), foreignBytes);
  }
}
async function outputRace(directory, mode) {
  const f = await setup(directory); const target = path.join(f.parent, 'result.json');
  if (mode === 'create-redirect') {
    let swapped = false; let injected = false; let denied = null;
    const sink = await createFileSink(target, '-', { create: stage => {
      if (stage !== 'before-create') return;
      injected = true; denied = attack(() => renameSync(f.parent, f.moved));
      if (denied === null) { symlinkSync(f.victim, f.parent, process.platform === 'win32' ? 'junction' : 'dir'); swapped = true; }
    } });
    try {
      requireInjection(injected, 'Native before-create boundary was not exercised');
      await sink.write(ownedBytes, signal()); await sink.commit(signal());
      assert.deepEqual(await fs.readdir(f.victim), ['input.log']);
      if (swapped) { await fs.unlink(f.parent); swapped = false; await fs.rename(f.moved, f.parent); }
      assert.equal(await fs.readFile(target, 'utf8'), ownedBytes);
      return { status: 'PASS', finding: 'LL-006', injected: true, baselineInjectionExecuted: true,
        nativeBoundary: 'before-create', observedDenial: denied, foreignTemporaryCreated: false, renderedBytesInForeignDirectory: false };
    } finally { await sink.discard(); if (swapped) { await fs.unlink(f.parent); await fs.rename(f.moved, f.parent); } }
  }
  // Demonstrate temp replacement is possible without a lease in this directory.
  const decoy = path.join(f.parent, '.loglens-control.tmp'); await fs.writeFile(decoy, replacementBytes);
  await fs.rename(decoy, decoy + '.owned'); await fs.rename(decoy + '.owned', decoy); await fs.unlink(decoy);
  let swapped = false; let denied = null; let temporary = null; let injected = false;
  const injection = stage => {
    if (injected) return;
    injected = true;
    if (mode === 'commit-cleanup-replacement') {
      assert.equal(stage, 'before-discard');
      temporary ??= '.loglens-foreign.tmp'; writeFileSync(path.join(f.parent, temporary), replacementBytes); return;
    }
    if (mode.includes('ancestor')) {
      denied = attack(() => renameSync(f.parent, f.moved));
      if (denied === null) { symlinkSync(f.victim, f.parent, process.platform === 'win32' ? 'junction' : 'dir'); swapped = true; }
    } else if (process.platform === 'win32') {
      assert.ok(temporary, 'Windows owned temp must exist');
      denied = attack(() => renameSync(path.join(f.parent, temporary), path.join(f.parent, temporary + '.owned')));
      assert.ok(denied, 'Windows protected temp replacement unexpectedly succeeded');
      assert.ok(attack(() => writeFileSync(path.join(f.parent, temporary), replacementBytes)), 'Protected file must deny writes');
    } else {
      assert.equal(temporary, undefined, 'Linux output must use an unnamed inode');
      temporary = '.loglens-foreign.tmp'; writeFileSync(path.join(f.parent, temporary), replacementBytes);
    }
  };
  const audit = mode.startsWith('discard') || mode === 'commit-cleanup-replacement' ? { discard: injection } : { commit: injection };
  const sink = await createFileSink(target, '-', audit);
  try {
    await sink.write(ownedBytes, signal());
    temporary = (await fs.readdir(f.parent)).find(name => name.endsWith('.tmp'));
    if (mode.startsWith('discard')) await sink.discard(); else await sink.commit(signal());
    await sink.discard();
    requireInjection(injected, 'Native publication/discard boundary was not exercised');
    if (swapped) { await fs.unlink(f.parent); swapped = false; await fs.rename(f.moved, f.parent); }
    assert.equal(await exists(target), !mode.startsWith('discard'));
    if (!mode.startsWith('discard')) assert.equal(await fs.readFile(target, 'utf8'), ownedBytes);
    assert.deepEqual(await fs.readdir(f.victim), ['input.log']);
    assert.equal(await fs.readFile(path.join(f.victim, 'input.log'), 'utf8'), foreignBytes);
    // A same-named unknown file after release is never removed by repeated cleanup.
    if (temporary) { await fs.writeFile(path.join(f.parent, temporary), replacementBytes); await sink.discard();
      assert.equal(await fs.readFile(path.join(f.parent, temporary), 'utf8'), replacementBytes); }
    return { status: 'PASS', finding: 'LL-006', injected: true, baselineInjectionExecuted: true,
      protectedAttackAttempted: true, observedDenial: denied, foreignDeleted: false, unsafePublished: false,
      nativeBoundary: mode.startsWith('discard') || mode === 'commit-cleanup-replacement' ? 'before-discard' : 'before-publish',
      unsafeDestinationAfterFailure: false, destinationExists: !mode.startsWith('discard'),
      method: 'Baseline injection, live native lease attack, exact output bytes, foreign directory preservation and repeated cleanup.' };
  } finally { await sink.discard(); if (swapped) { await fs.unlink(f.parent); await fs.rename(f.moved, f.parent); } }
}
export const cases = ['controls', 'input-ancestor-swap', 'create-redirect', 'publish-replacement', 'publish-restore',
  'publish-ancestor-swap', 'discard-replacement', 'commit-cleanup-replacement', 'discard-ancestor-swap'];
export function gateExitCode(records) {
  assert.ok(records.length > 0, 'An empty gate cannot pass');
  assert.ok(records.every(row => ['PASS', 'FAIL', 'ERROR'].includes(row.status)), 'Unknown status');
  return records.some(row => row.status === 'ERROR') ? 2 : records.some(row => row.status === 'FAIL') ? 1 : 0;
}
export async function auditFilesystem(selectedCases = cases) {
  assert.ok(selectedCases.length > 0 && new Set(selectedCases).size === selectedCases.length);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'loglens-race-audit-')); const records = [];
  try {
    for (const name of selectedCases) {
      try {
        if (!cases.includes(name)) throw new Error('Unknown audit case'); const local = path.join(directory, name); await fs.mkdir(local);
        records.push({ name, ...await (name === 'controls' ? controls(local) : name === 'input-ancestor-swap' ? inputRace(local) : outputRace(local, name)) });
      } catch (failure) { records.push({ name, status: systemCode(failure) === 'ERR_ASSERTION' ? 'FAIL' : 'ERROR', observedCode: systemCode(failure) ?? 'HARNESS_ERROR',
        expected: 'Baseline injection and protected attack must execute, and exact file postconditions must hold.' }); }
    }
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('loglens-race-audit-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
  const exitCode = gateExitCode(records);
  return { status: exitCode === 2 ? 'ERROR' : exitCode === 1 ? 'FAIL' : 'PASS', exitCode, platform: process.platform, node: process.version, records,
    method: 'Deterministic native before-leaf/create/publish/discard hooks, working unprotected controls, protected attacks and exact postconditions. Historical pathname hooks retained separately.',
    limitations: 'Finite single-process native-boundary scheduling; no exhaustive multi-principal or unexecuted operating-system claim.' };
}
