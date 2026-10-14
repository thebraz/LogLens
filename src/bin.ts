#!/usr/bin/env node
import { AppError } from './contracts/model.js';
import { parseArguments, help, version } from './cli/args.js';
import { diagnostic, runCommand } from './cli/run.js';
import { writeStream } from './io/sink.js';
import { systemCode } from './io/paths.js';

const controller = new AbortController(); let signalStatus = 0; let pipeClosed = false;
const interrupt = (signal: NodeJS.Signals) => { signalStatus = signal === 'SIGINT' ? 130 : 143; controller.abort(); };
const sigint = () => interrupt('SIGINT'); const sigterm = () => interrupt('SIGTERM');
const outputError = (error: unknown) => { if (systemCode(error) === 'EPIPE') pipeClosed = true; controller.abort(); };
process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
process.stdout.on('error', outputError); process.stderr.on('error', outputError);
try {
  const action = parseArguments(process.argv.slice(2), process.stdin.isTTY === true);
  if (action.kind === 'help' || action.kind === 'version') {
    await writeStream(process.stdout, action.kind === 'help' ? help : version + '\n', controller.signal); process.exitCode = 0;
  } else {
    const { result, usable } = await runCommand(action.plan, { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, signal: controller.signal });
    process.exitCode = pipeClosed ? 141 : signalStatus || (!usable ? 4 : result.coverage === 'partial' ? 3 : result.command === 'search' && result.stats.matchedEvents === 0 ? 1 : 0);
  }
} catch (error) {
  const failure = error instanceof AppError ? error : new AppError('INTERNAL_INVARIANT');
  process.exitCode = pipeClosed || failure.code === 'EPIPE' ? 141 : signalStatus ||
    (failure.code === 'USAGE' || failure.code === 'NOT_AVAILABLE' ? 2 : 4);
  if (!pipeClosed && !signalStatus && failure.code !== 'EPIPE') {
    const argv = process.argv.slice(2); const machine = argv.some((arg, index) => arg === '--output-format=json' || arg === '--output-format=ndjson' || (arg === '--output-format' && (argv[index + 1] === 'json' || argv[index + 1] === 'ndjson')));
    await diagnostic(failure.code, machine, process.stderr, new AbortController().signal).catch(() => undefined);
  }
} finally {
  process.removeListener('SIGINT', sigint); process.removeListener('SIGTERM', sigterm);
  // Keep stream error handlers through process shutdown: write callbacks may precede error emission.
  process.stdin.destroy();
}
