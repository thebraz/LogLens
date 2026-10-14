import { parseArgs } from 'node:util';
import { AppError, severities } from '../contracts/model.js';
import type { Command, IdKind, Plan, Severity } from '../contracts/model.js';
import { offsetMinutes, parseTime } from '../core/time.js';

export const version = '0.1.0-beta.1';
export const help = `LogLens ${version} — local log diagnostics (beta candidate)
Usage: loglens <inspect|search|group|report> [files...|-] [options]
       loglens --help | --version
Explicit regular UTF-8 files, gzip by magic, or stdin (once); no inputs = piped stdin.
Sequential source order; text multiline folding. Options precede positional --.
  --format auto|jsonl|text       Default auto, per-record recognition
  --output-format FORMAT        inspect/group: text|json; search: text|json|ndjson;
                                report: markdown|html|json (default markdown)
  --output PATH                 New file only; - means stdout
  --assume-timezone UTC|±HH:mm    Fixed offset for zone-less input times
  --level LIST                  Canonical severities, comma-separated
  --since TIME --until TIME      Inclusive/exclusive explicit-offset bounds
  --source LABEL_OR_ID           Repeatable exact source selection
  --service NAME                 Exact service
  --id request:VALUE             Repeatable OR; request|trace|span namespaces
  --query LITERAL                Required for search; normalized message only
  --ignore-case                  Search: ASCII A–Z folding
  --before N --after N           Search context 0–100 each (default 0)
  --limit N                      Search rendered matches 1–1000000 (default 100)
  --by MODE                      Group: fingerprint|severity|source|request-id|trace-id|span-id
  --top N                        Group/report rows 1–10000 (default 20)
  --bucket 1m|1h|1d               Report UTC timeline (default 1h)
  --include-raw                  Search JSON/NDJSON bounded raw projection
  --no-redact --ack-sensitive-output  Paired sensitive-output opt-out
  --help                         No input access
  --version                      Global only
Selection uses original content. No inferred causes. No regex/globs/directories.
Redaction may miss arbitrary PII/custom/encoded secrets. Fingerprints reveal equality.
Limits: 1024 sources; 1 MiB line; 4 MiB event; 16 KiB message; 64 KiB metadata;
10000 keys/map; 64 MiB aggregation; 10 GiB/source; 50 GiB/run;
gzip 200:1 after 1 MiB; aggregate/JSON search 32 MiB. NDJSON/text search streams.
Encoded gzip also capped at 10 GiB/source and 50 GiB/run, including headers.
No telemetry, network, server or database.
Exit: 0 complete; 1 search no match; 2 usage; 3 partial; 4 I/O/safety;
130 SIGINT; 143 SIGTERM (where supported); 141 closed stdout pipe.
`;
export type Action = { kind: 'help' } | { kind: 'version' } | { kind: Command; plan: Plan };
export function parseArguments(argv: string[], stdinIsTTY: boolean): Action {
  const delimiter = argv.indexOf('--');
  if ((delimiter < 0 ? argv : argv.slice(0, delimiter)).includes('--help')) return { kind: 'help' };
  try {
    const parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, tokens: true, options: {
      help: { type: 'boolean' }, version: { type: 'boolean' }, format: { type: 'string' },
      'output-format': { type: 'string' }, output: { type: 'string' }, 'assume-timezone': { type: 'string' },
      level: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' },
      source: { type: 'string', multiple: true }, service: { type: 'string' }, id: { type: 'string', multiple: true },
      query: { type: 'string' }, 'ignore-case': { type: 'boolean' }, before: { type: 'string' }, after: { type: 'string' },
      limit: { type: 'string' }, by: { type: 'string' }, top: { type: 'string' }, bucket: { type: 'string' },
      'include-raw': { type: 'boolean' }, 'no-redact': { type: 'boolean' }, 'ack-sensitive-output': { type: 'boolean' }
    } });
    const seen = new Set<string>();
    for (const token of parsed.tokens) if (token.kind === 'option') {
      if ((seen.has(token.name) && token.name !== 'source' && token.name !== 'id') || token.value === '') throw new AppError('USAGE');
      seen.add(token.name);
    }
    const v = parsed.values;
    if (v.version) { if (argv.length !== 1) throw new AppError('USAGE'); return { kind: 'version' }; }
    const command = parsed.positionals[0];
    if (command !== 'inspect' && command !== 'search' && command !== 'group' && command !== 'report') throw new AppError('USAGE');
    const inputs = parsed.positionals.slice(1);
    if (inputs.some(x => !x) || inputs.filter(x => x === '-').length > 1 || (!inputs.length && stdinIsTTY)) throw new AppError('USAGE');
    if (!inputs.length) inputs.push('-');
    const only = (names: string[], commands: Command[]) => {
      if (!commands.includes(command) && names.some(x => seen.has(x))) throw new AppError('USAGE');
    };
    only(['query', 'ignore-case', 'before', 'after', 'limit', 'include-raw'], ['search']);
    only(['by'], ['group']); only(['top'], ['group', 'report']); only(['bucket'], ['report']);
    const format = v.format ?? 'auto';
    if (format !== 'auto' && format !== 'text' && format !== 'jsonl') throw new AppError('USAGE');
    const outputFormat = v['output-format'] ?? (command === 'report' ? 'markdown' : 'text');
    if (outputFormat !== 'text' && outputFormat !== 'json' && outputFormat !== 'ndjson' && outputFormat !== 'html' && outputFormat !== 'markdown') throw new AppError('USAGE');
    const allowed = command === 'report' ? ['json', 'markdown', 'html'] : command === 'search' ? ['text', 'json', 'ndjson'] : ['text', 'json'];
    if (!allowed.includes(outputFormat) || (v['include-raw'] && outputFormat !== 'json' && outputFormat !== 'ndjson')) throw new AppError('USAGE');
    if (Boolean(v['no-redact']) !== Boolean(v['ack-sensitive-output'])) throw new AppError('USAGE');
    const assumeTimezone = v['assume-timezone'] ?? null;
    if (assumeTimezone !== null && (assumeTimezone === 'Z' || offsetMinutes(assumeTimezone) === null)) throw new AppError('USAGE');
    const bound = (value: string | undefined): number | null => {
      if (value === undefined) return null;
      const time = parseTime(value, null).timestamp;
      if (time === null) throw new AppError('USAGE'); return time.epochMs;
    };
    const since = bound(v.since); const until = bound(v.until);
    if (since !== null && until !== null && since >= until) throw new AppError('USAGE');
    const levels: Severity[] = [];
    for (const level of v.level?.split(',') ?? []) {
      const valid = severities.find(x => x === level); if (!valid) throw new AppError('USAGE');
      if (!levels.includes(valid)) levels.push(valid);
    }
    const ids: { kind: IdKind; value: string }[] = [];
    for (const token of new Set(v.id ?? [])) {
      const split = token.indexOf(':'); const kind = token.slice(0, split); const value = token.slice(split + 1);
      if (split < 0 || !value || Buffer.byteLength(value) > 512 || (kind !== 'request' && kind !== 'trace' && kind !== 'span')) throw new AppError('USAGE');
      ids.push({ kind, value });
    }
    const number = (value: string | undefined, fallback: number, min: number, max: number) => {
      if (value === undefined) return fallback;
      if (!/^\d+$/.test(value)) throw new AppError('USAGE'); const n = Number(value);
      if (!Number.isSafeInteger(n) || n < min || n > max) throw new AppError('USAGE'); return n;
    };
    const by = v.by ?? 'fingerprint';
    if (by !== 'fingerprint' && by !== 'severity' && by !== 'source' && by !== 'request-id' && by !== 'trace-id' && by !== 'span-id') throw new AppError('USAGE');
    const bucket = v.bucket ?? '1h'; if (bucket !== '1m' && bucket !== '1h' && bucket !== '1d') throw new AppError('USAGE');
    const query = v.query ?? '';
    if ((command === 'search' && !query) || Buffer.byteLength(query) > 4096 || (v.service !== undefined && Buffer.byteLength(v.service) > 256)) throw new AppError('USAGE');
    return { kind: command, plan: { command, inputs, format, outputFormat, output: v.output ?? null, assumeTimezone,
      levels, since, until, sources: [...new Set(v.source ?? [])], service: v.service ?? null, ids, query,
      ignoreCase: Boolean(v['ignore-case']), before: number(v.before, 0, 0, 100), after: number(v.after, 0, 0, 100),
      limit: number(v.limit, 100, 1, 1000000), by, top: number(v.top, 20, 1, 10000), bucket,
      includeRaw: Boolean(v['include-raw']), redact: !v['no-redact'] } };
  } catch (error) { if (error instanceof AppError) throw error; throw new AppError('USAGE'); }
}
