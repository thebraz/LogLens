import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { AppError, addCount, limits } from '../contracts/model.js';
import type { ErrorCode, Plan } from '../contracts/model.js';
import type { Project, SourceOutcome } from '../contracts/output.js';
import { frameLines } from '../io/framing.js';
import { readInput } from '../io/input.js';
import { createFileSink, writeStream } from '../io/sink.js';
import { parseRecords } from '../core/records.js';
import { createAnalysis } from '../core/analysis.js';
import { createSearch } from '../core/search.js';
import { renderCommand, renderEvent, renderReport } from '../output/render.js';
import { canonical } from '../core/json.js';
import { protectedLabel } from '../output/protect.js';
import { project, protectedValue } from '../output/project.js';

export interface Environment { stdin: Readable; stdout: Writable; stderr: Writable; signal: AbortSignal }
const descriptions: Readonly<Partial<Record<ErrorCode, string>>> = {
  USAGE: 'Invalid arguments; use --help for syntax.', NOT_AVAILABLE: 'The requested capability is unavailable in this installation.',
  INPUT_NOT_FOUND: 'The selected input file was not found.', INPUT_PERMISSION: 'Permission to inspect the input path was denied.',
  INPUT_READ: 'The input could not be read completely.', UNSAFE_PATH: 'The input path is redirected or is not a safe regular file.',
  UNSUPPORTED_ENCODING: 'Input must use UTF-8; UTF-16 and UTF-32 are unsupported.',
  SOURCE_TRUNCATED: 'The opened input ended before its original size.', SOURCE_BYTE_LIMIT: 'The source byte limit was reached; coverage is incomplete.',
  RUN_BYTE_LIMIT: 'The run byte limit was reached; coverage is incomplete.', GZIP_INVALID: 'Gzip input is invalid or incomplete.',
  GZIP_RATIO_LIMIT: 'Gzip expansion exceeded the allowed ratio.',
  UNSAFE_OUTPUT: 'A safe new-file output could not be created or committed.', OUTPUT_EXISTS: 'The output destination already exists and was preserved.',
  OUTPUT_WRITE: 'The output could not be written completely.', OUTPUT_LIMIT: 'Output exceeded its size limit; use NDJSON for large search results.',
  INTERNAL_INVARIANT: 'An internal invariant failed; no complete result is claimed.'
};
export async function diagnostic(code: string, machine: boolean, writer: Writable, signal: AbortSignal, sourceId: string | null = null): Promise<void> {
  const message = Object.entries(descriptions).find(([key]) => key === code)?.[1] ?? 'Record diagnostic detected; see summary counts and coverage.';
  await writeStream(writer, machine ? canonical({ schemaVersion: 'loglens.output.v1', type: 'diagnostic', code, sourceId, message }) + '\n'
    : `loglens: ${code}: ${message}\n`, signal);
}
export function discover(inputs: string[], platform: string = process.platform): string[] {
  const found: string[] = []; const seen = new Set<string>();
  for (const input of inputs) {
    const absolute = input === '-' ? '-' : path.resolve(input); const key = platform === 'win32' ? absolute.toLowerCase() : absolute;
    if (!seen.has(key)) { seen.add(key); found.push(absolute); }
  }
  if (found.length > limits.sources) throw new AppError('USAGE'); return found;
}
export async function runCommand(plan: Plan, env: Environment) {
  const inputs = discover(plan.inputs); const machine = plan.outputFormat === 'json' || plan.outputFormat === 'ndjson';
  const projection: Project = (event, match, representative) => project(event, match, plan.redact, plan.includeRaw, representative);
  const analysis = createAnalysis(plan, projection, value => protectedValue(value, plan.redact));
  const result = analysis.result; const run = { bytesRead: 0 }; const encodedRun = { bytesRead: 0 };
  const sink = plan.output !== null && plan.output !== '-' ? await createFileSink(plan.output, inputs) : null;
  const write = async (text: string) => { if (sink) await sink.write(text, env.signal); else await writeStream(env.stdout, text, env.signal); };
  let searchBytes = 0; let usable = false;
  const search = createSearch(plan, result, projection, async event => {
    const serialized = canonical(event);
    if (plan.outputFormat === 'json') {
      const size = Buffer.byteLength(serialized) + 1;
      if (size > limits.aggregate - searchBytes) throw new AppError('OUTPUT_LIMIT');
      searchBytes += size; result.events.push(event);
    } else await write(plan.outputFormat === 'ndjson' ? canonical({ schemaVersion: 'loglens.output.v1', type: 'event', event }) + '\n' : renderEvent(event));
  });
  try {
    if (plan.outputFormat === 'ndjson') await write(canonical({ schemaVersion: 'loglens.output.v1', type: 'start', command: 'search', redaction: result.redaction }) + '\n');
    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index]; if (input === undefined) throw new AppError('INTERNAL_INVARIANT');
      env.signal.throwIfAborted(); search.boundary();
      const source = { id: `s${String(index + 1).padStart(6, '0')}`, label: input === '-' ? 'stdin' : path.basename(input), kind: input === '-' ? 'stdin' : 'file' } as const;
      const outcome: SourceOutcome = { ...source, status: 'complete', bytesRead: 0, eventsRead: 0, damagedEvents: 0, errors: [] };
      const progress = { bytesRead: 0, physicalLines: 0 }; const codes = new Set<string>(); let failure: ErrorCode | null = null;
      try {
        for await (const parsed of parseRecords(frameLines(readInput(input, env.stdin, env.signal, encodedRun), progress, env.signal, run), source, plan, analysis.blank)) {
          env.signal.throwIfAborted();
          const selected = analysis.accept(parsed, outcome); for (const code of parsed.codes) codes.add(code);
          if (plan.command === 'search') await search.accept(parsed.event, selected);
        }
        usable = true;
      } catch (error) {
        if (env.signal.aborted) throw new AppError('INTERRUPTED');
        if (!(error instanceof AppError)) throw new AppError('INTERNAL_INVARIANT');
        if (!['INPUT_NOT_FOUND','INPUT_PERMISSION','INPUT_READ','UNSAFE_PATH','UNSUPPORTED_ENCODING','SOURCE_TRUNCATED','GZIP_INVALID','GZIP_RATIO_LIMIT','SOURCE_BYTE_LIMIT','RUN_BYTE_LIMIT'].includes(error.code)) throw error;
        failure = error.code; outcome.errors.push(failure); codes.add(failure); result.coverage = 'partial';
        if (failure === 'RUN_BYTE_LIMIT') { analysis.issue(failure); outcome.errors = []; }
        if (outcome.eventsRead > 0 || (progress.physicalLines > 0 && failure !== 'UNSUPPORTED_ENCODING')) usable = true;
      }
      outcome.bytesRead = progress.bytesRead;
      outcome.status = failure !== null || outcome.damagedEvents > 0 ? (progress.bytesRead > 0 || outcome.eventsRead > 0 ? 'partial' : 'failed') : 'complete';
      outcome.label = protectedLabel(source.label, plan.redact); result.sources.push(outcome);
      result.stats.bytesRead = addCount(result.stats.bytesRead, progress.bytesRead); result.stats.physicalLines = addCount(result.stats.physicalLines, progress.physicalLines);
      for (const code of [...codes].sort()) await diagnostic(code, machine, env.stderr, env.signal, source.id);
      if (failure === 'RUN_BYTE_LIMIT') break;
    }
    analysis.finish();
    for (const code of result.issues) await diagnostic(code, machine, env.stderr, env.signal);
    let output = plan.outputFormat === 'json' ? canonical(result) + '\n' : plan.outputFormat === 'ndjson' ? canonical({ schemaVersion: 'loglens.output.v1', type: 'summary', result }) + '\n'
      : plan.outputFormat === 'html' || plan.outputFormat === 'markdown' ? renderReport(result, plan.outputFormat) : renderCommand(result);
    if (Buffer.byteLength(output) > limits.aggregate) throw new AppError('OUTPUT_LIMIT');
    await write(output); output = '';
    env.signal.throwIfAborted(); if (sink && usable) await sink.commit(env.signal);
    return { result, usable };
  } finally { await sink?.discard(); }
}
