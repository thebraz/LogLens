import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { openInput, systemCode } from '../dist/io/paths.js';
import { createFileSink } from '../dist/io/sink.js';

const original = { lstat: fs.lstat, open: fs.open, link: fs.link, unlink: fs.unlink };
const selectedBytes = 'INFO selected\n'; const foreignBytes = 'INFO SYNTHETIC_UNSELECTED\n';
const ownedBytes = 'owned report\n'; const replacementBytes = 'synthetic replacement\n';
const signal = () => new AbortController().signal;
const reset = () => { Object.assign(fs, original); syncBuiltinESMExports(); };
const redirect = (from, to) => fs.symlink(to, from, process.platform === 'win32' ? 'junction' : 'dir');
async function exists(file) {
  try { await original.lstat(file); return true; }
  catch (error) { if (systemCode(error) === 'ENOENT') return false; throw error; }
}
async function expectedFailure(operation, allowed) {
  try { await operation(); return null; }
  catch (error) { if (systemCode(error) !== allowed) throw error; return allowed; }
}
async function controls(directory) {
  const input = path.join(directory, 'input.log'); await fs.writeFile(input, selectedBytes);
  const opened = await openInput(input);
  try { assert.equal(await opened.handle.readFile('utf8'), selectedBytes); } finally { await opened.handle.close(); }
  const target = path.join(directory, 'result.json'); const sink = await createFileSink(target, input);
  try { await sink.write(ownedBytes, signal()); await sink.commit(signal()); } finally { await sink.discard(); }
  assert.equal(await fs.readFile(target, 'utf8'), ownedBytes); assert.equal(await fs.readFile(input, 'utf8'), selectedBytes);
  const raced = path.join(directory, 'raced.json'); const other = await createFileSink(raced, input);
  try {
    await other.write(ownedBytes, signal()); await fs.writeFile(raced, replacementBytes);
    await assert.rejects(other.commit(signal()), { code: 'OUTPUT_EXISTS' });
  } finally { await other.discard(); }
  assert.equal(await fs.readFile(raced, 'utf8'), replacementBytes);
  assert.equal((await fs.readdir(directory)).filter(name => name.endsWith('.tmp')).length, 0);
  return { status: 'PASS', noInputMutation: true, noTemporaryResidue: true };
}
async function inputRace(directory) {
  const selected = path.join(directory, 'selected'); const moved = path.join(directory, 'moved'); const victim = path.join(directory, 'victim');
  const target = path.join(selected, 'input.log');
  await fs.mkdir(selected); await fs.mkdir(victim);
  await fs.writeFile(target, selectedBytes); await fs.writeFile(path.join(victim, 'input.log'), foreignBytes);
  let swapped = false; let injected = false; let calls = 0; let handle = null; let content = null;
  try {
    fs.lstat = async (...args) => {
      if (path.resolve(String(args[0])) === target && ++calls === 2) {
        await fs.rename(selected, moved); await redirect(selected, victim); swapped = true; injected = true;
      }
      return original.lstat(...args);
    };
    fs.open = async (...args) => {
      const opened = await original.open(...args);
      if (path.resolve(String(args[0])) === target && swapped) {
        await original.unlink(selected); swapped = false; await fs.rename(moved, selected);
      }
      return opened;
    };
    syncBuiltinESMExports();
    const error = await expectedFailure(async () => {
      const opened = await openInput(target); handle = opened.handle; content = await handle.readFile('utf8');
    }, 'UNSAFE_PATH');
    assert.ok(injected, 'Fault injection was not exercised; a changed implementation requires reviewed hooks');
    assert.ok(content === null || content === selectedBytes || content === foreignBytes, 'Unexpected input bytes');
    return { status: content === foreignBytes ? 'FAIL' : 'PASS', finding: 'LL-008', injected, error, unsafeRead: content === foreignBytes,
      expected: 'Reject UNSAFE_PATH or read only the independently selected fixture; never read the other fixture.' };
  } finally {
    reset(); await handle?.close();
    if (swapped) { await original.unlink(selected); await fs.rename(moved, selected); }
  }
}
async function outputRace(directory, mode) {
  const parent = path.join(directory, 'selected'); const moved = path.join(directory, 'moved'); const victim = path.join(directory, 'victim');
  await fs.mkdir(parent); await fs.mkdir(victim);
  const target = path.join(parent, 'result.json'); let temporary = null; let sink = null; let error = null;
  let injected = false; let swapped = false; let foreignDeleted = false; let unsafePublished = false;
  try {
    if (mode === 'create-redirect') {
      fs.open = async (...args) => {
        const file = String(args[0]);
        if (path.dirname(file) === parent && file.endsWith('.tmp')) {
          await fs.rename(parent, moved); await redirect(parent, victim); swapped = true; injected = true;
          const opened = await original.open(...args);
          await original.unlink(parent); swapped = false; await fs.rename(moved, parent);
          return opened;
        }
        return original.open(...args);
      };
      syncBuiltinESMExports();
      error = await expectedFailure(async () => {
        sink = await createFileSink(target, '-'); await sink.write(ownedBytes, signal()); await sink.commit(signal());
      }, 'UNSAFE_OUTPUT');
      reset(); await sink?.discard(); sink = null;
      const foreignTemps = (await fs.readdir(victim)).filter(name => name.endsWith('.tmp'));
      const leaked = foreignTemps.length > 0 && await fs.readFile(path.join(victim, foreignTemps[0]), 'utf8') === ownedBytes;
      assert.ok(injected, 'Creation injection was not exercised');
      return { status: foreignTemps.length === 0 && !await exists(target) ? 'PASS' : 'FAIL', finding: 'LL-006', injected, error,
        foreignTemporaryCreated: foreignTemps.length > 0, renderedBytesInForeignDirectory: leaked,
        expected: 'No temporary creation, output bytes, or published destination in the redirected directory.' };
    }
    sink = await createFileSink(target, '-'); await sink.write(ownedBytes, signal());
    const names = (await fs.readdir(parent)).filter(name => name.endsWith('.tmp')); assert.equal(names.length, 1);
    temporary = path.join(parent, names[0]);
    if (mode === 'discard-replacement' || mode === 'commit-cleanup-replacement' || mode === 'discard-ancestor-swap') {
      fs.unlink = async (...args) => {
        if (String(args[0]) === temporary && !injected) {
          if (mode === 'discard-ancestor-swap') {
            await fs.rename(parent, moved); await redirect(parent, victim); swapped = true;
          } else await fs.rename(temporary, temporary + '.owned');
          await fs.writeFile(temporary, replacementBytes); injected = true;
          try { await original.unlink(...args); foreignDeleted = !await exists(temporary); }
          finally { if (swapped) { await original.unlink(parent); swapped = false; await fs.rename(moved, parent); } }
          return;
        }
        return original.unlink(...args);
      };
    } else {
      fs.link = async (...args) => {
        if (process.env.LOGLENS_AUDIT_DEBUG === '1') {
  console.error('[DEBUG] fs.link executado:', String(args[0]) === temporary);
}
        if (String(args[0]) === temporary && !injected) {
          if (mode === 'publish-ancestor-swap') {
  try {
    await fs.rename(parent, moved);
    console.error('[DEBUG] Diretório renomeado com sucesso');

    await redirect(parent, victim);
    console.error('[DEBUG] Junction criada com sucesso');

    swapped = true;
  } catch (cause) {
    console.error('[DEBUG] Falha na troca do diretório:', cause);
    throw cause;
  }
} else await fs.rename(temporary, temporary + '.owned');
          await fs.writeFile(temporary, replacementBytes); injected = true;
          await original.link(...args); unsafePublished = await fs.readFile(target, 'utf8') === replacementBytes;
          if (mode === 'publish-restore') {
            // Restore both checked names after the real link, before the product's published-identity check.
            await original.unlink(target); await original.unlink(temporary);
            await fs.rename(temporary + '.owned', temporary); await original.link(temporary, target);
          }
          if (swapped) { await original.unlink(parent); swapped = false; await fs.rename(moved, parent); }
          return;
        }
        return original.link(...args);
      };
    }
    syncBuiltinESMExports();
    error = await expectedFailure(async () => {
      if (mode === 'discard-replacement' || mode === 'discard-ancestor-swap') await sink.discard(); else await sink.commit(signal());
    }, 'UNSAFE_OUTPUT');
    reset(); await sink.discard(); sink = null;
    assert.ok(injected, 'Publication/cleanup injection was not exercised');
    const destinationExists = await exists(target);
    const unsafeRemains = destinationExists && await fs.readFile(target, 'utf8') === replacementBytes;
    const foreignDestination = path.join(victim, 'result.json');
    const unsafeForeignRemains = await exists(foreignDestination) && await fs.readFile(foreignDestination, 'utf8') === replacementBytes;
    return { status: foreignDeleted || unsafePublished || unsafeRemains || unsafeForeignRemains ? 'FAIL' : 'PASS', finding: 'LL-006', injected, error,
      foreignDeleted, unsafePublished, unsafeDestinationAfterFailure: unsafeRemains || unsafeForeignRemains, destinationExists,
      expected: 'Never publish replacement bytes, even transiently; never unlink a replacement after an ownership check.' };
  } finally {
    reset(); await sink?.discard();
    if (swapped) { await original.unlink(parent); await fs.rename(moved, parent); }
  }
}
export const cases = ['controls', 'input-ancestor-swap', 'create-redirect', 'publish-replacement', 'publish-restore',
  'publish-ancestor-swap', 'discard-replacement', 'commit-cleanup-replacement', 'discard-ancestor-swap'];
export function gateExitCode(records) {
  assert.ok(records.length > 0, 'An empty gate cannot pass');
  assert.ok(records.every(row => ['PASS', 'FAIL', 'ERROR'].includes(row.status)), 'Unknown status');
  return records.some(row => row.status === 'ERROR') ? 2 : records.some(row => row.status === 'FAIL') ? 1 : 0;
}
export async function auditFilesystem(selectedCases = cases) {
  assert.ok(selectedCases.length > 0 && new Set(selectedCases).size === selectedCases.length, 'Cases must be nonempty and unique');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'loglens-race-audit-')); const records = [];
  try {
    for (const name of selectedCases) {
      try {
        assert.ok(cases.includes(name), 'Unknown audit case'); const local = path.join(directory, name); await fs.mkdir(local);
        const row = name === 'controls' ? await controls(local) : name === 'input-ancestor-swap' ? await inputRace(local) : await outputRace(local, name);
        records.push({ name, ...row });
      } catch (failure) {
  if (process.env.LOGLENS_AUDIT_DEBUG === '1') {
    console.error(
      `[AUDIT ${name}]`,
      failure instanceof Error ? failure.stack : String(failure)
    );
  }

  records.push({ name, status: 'ERROR', observedCode: systemCode(failure) ?? 'HARNESS_ASSERTION',
          expected: 'Mandatory setup and injection must execute; unexpected/access errors cannot establish security.' });
      } finally { reset(); }
    }
  } finally {
    reset(); const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('loglens-race-audit-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
  const exitCode = gateExitCode(records);
  return { status: exitCode === 2 ? 'ERROR' : exitCode === 1 ? 'FAIL' : 'PASS', exitCode,
    platform: process.platform, node: process.version, records,
    method: 'Deterministic scheduling around real filesystem calls and descriptors; isolated synthetic fixtures only.',
    limitations: 'Single-process injection is not a timed multi-principal exploit. PASS covers only exercised schedules, not atomic confinement or other operating systems.' };
}
