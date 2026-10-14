export const severities = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'unknown'] as const;
export type Severity = typeof severities[number];
export const eventCodes = ['INVALID_UTF8', 'INVALID_UNICODE', 'INVALID_NUMBER', 'MALFORMED_JSON',
  'NON_OBJECT_JSON', 'INVALID_TIME', 'AMBIGUOUS_TIME', 'UNKNOWN_SEVERITY', 'MISSING_MESSAGE',
  'INVALID_FIELD', 'CONFLICTING_FIELDS', 'UNSAFE_KEY', 'ORPHAN_CONTINUATION', 'LINE_TOO_LARGE',
  'EVENT_TOO_LARGE', 'FIELD_TOO_LARGE', 'METADATA_LIMIT', 'DIAGNOSTICS_LIMIT', 'SOURCE_TRUNCATED'] as const;
export type EventCode = typeof eventCodes[number];
export type ErrorCode = 'INPUT_NOT_FOUND' | 'INPUT_PERMISSION' | 'INPUT_READ' | 'UNSAFE_PATH' |
  'UNSUPPORTED_ENCODING' | 'SOURCE_TRUNCATED' | 'SOURCE_BYTE_LIMIT' | 'GZIP_INVALID' | 'GZIP_RATIO_LIMIT' | 'RUN_BYTE_LIMIT' | 'NOT_AVAILABLE' |
  'USAGE' | 'UNSAFE_OUTPUT' | 'OUTPUT_EXISTS' | 'OUTPUT_WRITE' | 'OUTPUT_LIMIT' |
  'INTERNAL_INVARIANT' | 'INTERRUPTED' | 'EPIPE';
export class AppError extends Error {
  constructor(public readonly code: ErrorCode, public readonly consumedBytes = 0) { super(code); }
}
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Source { id: string; label: string; kind: 'file' | 'stdin' }
export interface Position { lineStart: number; lineEnd: number; byteStart: number; byteEnd: number }
export interface Timestamp {
  epochMs: number; isoUtc: string; original: string;
  interpretation: 'epoch-ms' | 'explicit-offset' | 'assumed-offset';
}
export interface Diagnostic { code: EventCode; line: number; field: string | null }
export interface LogEvent {
  schemaVersion: 'loglens.event.v1'; id: string; source: Source; position: Position;
  timestamp: Timestamp | null; severity: Severity; severityOriginal: string | null;
  message: string; service: string | null; logger: string | null;
  correlation: { requestId: string | null; traceId: string | null; spanId: string | null };
  attributes: { [key: string]: Json };
  raw: { text: string; complete: boolean; byteLength: number; sha256: string };
  format: 'text' | 'jsonl'; diagnostics: Diagnostic[];
}
export interface Parsed { event: LogEvent; codes: ReadonlySet<EventCode>; damaged: boolean }
export interface Line {
  text: string; position: Position; byteLength: number; sha256: string;
  complete: boolean; invalidUtf8: boolean; sourceTruncated?: boolean;
  bytes?: Uint8Array;
}
export type Command = 'inspect' | 'search' | 'group' | 'report';
export type GroupMode = 'fingerprint' | 'severity' | 'source' | 'request-id' | 'trace-id' | 'span-id';
export type IdKind = 'request' | 'trace' | 'span';
export interface Plan {
  command: Command; inputs: string[]; format: 'auto' | 'text' | 'jsonl'; outputFormat: 'text' | 'json' | 'ndjson' | 'markdown' | 'html';
  output: string | null; assumeTimezone: string | null;
  levels: Severity[]; since: number | null; until: number | null; sources: string[];
  service: string | null; ids: { kind: IdKind; value: string }[];
  query: string; ignoreCase: boolean; before: number; after: number; limit: number;
  by: GroupMode; top: number; bucket: '1m' | '1h' | '1d'; includeRaw: boolean; redact: boolean;
}
export const limits = {
  chunk: 64 * 1024, line: 1024 * 1024, prefix: 64 * 1024, message: 16 * 1024,
  metadata: 64 * 1024, depth: 32, nodes: 10000, diagnostics: 64,
  sourceBytes: 10 * 1024 ** 3, runBytes: 50 * 1024 ** 3, aggregate: 32 * 1024 ** 2,
  event: 4 * 1024 ** 2, projection: 64 * 1024, representative: 8 * 1024,
  contextBytes: 8 * 1024 ** 2, keys: 10000, stateBytes: 64 * 1024 ** 2, sources: 1024
} as const;
export function addCount(value: number, increment = 1): number {
  const result = value + increment;
  if (!Number.isSafeInteger(result) || result < 0) throw new AppError('INTERNAL_INVARIANT');
  return result;
}
