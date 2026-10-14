import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditFilesystem, cases } from './filesystem-cases.mjs';
import { systemCode } from '../dist/io/paths.js';

try {
  assert.ok(process.argv.length <= 3, 'Use at most one case name');
  const evidence = await auditFilesystem(process.argv[2] ? [process.argv[2]] : cases);
  // Separate evidence keeps the original FAIL record and its original harness exit intact.
  const output = process.env.LOGLENS_EVIDENCE_DIR ?? fileURLToPath(new URL('../evidence/stage-3-final-security', import.meta.url));
  await mkdir(output, { recursive: true });
  const name = process.argv[2] ? `filesystem-${cases.includes(process.argv[2]) ? process.argv[2] : 'invalid'}.json` : 'filesystem-race.json';
  await writeFile(path.join(output, name), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify(evidence) + '\n');
  process.exitCode = evidence.exitCode;
} catch (error) {
  process.stdout.write(JSON.stringify({ status: 'ERROR', exitCode: 2, observedCode: systemCode(error) ?? 'HARNESS_ASSERTION' }) + '\n');
  process.exitCode = 2;
}
