import { AppError, limits } from '../contracts/model.js';
import type { Json, LogEvent } from '../contracts/model.js';
import type { ProjectedEvent } from '../contracts/output.js';
import { canonical, prefix } from '../core/json.js';
import { escapeControls, protectJson, redact, redactJsonText } from './protect.js';

export function project(event: LogEvent, match: ProjectedEvent['match'], enabled: boolean, includeRaw: boolean, representative = false): ProjectedEvent {
  let changed = false;
  const text = (value: string, incomplete = false, structured = false): string => {
    const clean = enabled ? (structured ? redactJsonText(value, incomplete) : redact(value, incomplete)) : value;
    changed ||= clean !== value; return escapeControls(clean);
  };
  const nullable = (value: string | null): string | null => value === null ? null : text(value);
  const attributes = protectJson(event.attributes, enabled);
  if (attributes === null || Array.isArray(attributes) || typeof attributes !== 'object') throw new AppError('INTERNAL_INVARIANT');
  changed ||= enabled && canonical(attributes) !== canonical(protectJson(event.attributes, false));
  const label = text(event.source.label); const exportedLabel = prefix(label, 256);
  const value: ProjectedEvent = { ...event, source: { ...event.source, label: exportedLabel }, position: { ...event.position },
    timestamp: event.timestamp === null ? null : { ...event.timestamp, original: text(event.timestamp.original) },
    severityOriginal: event.severityOriginal === null ? null : text(event.severityOriginal, event.diagnostics.some(d => d.code === 'FIELD_TOO_LARGE' && d.field === 'severityOriginal')),
    message: text(event.message, event.diagnostics.some(d => d.code === 'FIELD_TOO_LARGE' && d.field === 'message'), /^[ \t]*\{/.test(event.message)), service: nullable(event.service), logger: nullable(event.logger),
    correlation: { requestId: nullable(event.correlation.requestId), traceId: nullable(event.correlation.traceId), spanId: nullable(event.correlation.spanId) },
    attributes, raw: includeRaw ? { ...event.raw, text: text(event.raw.text, !event.raw.complete, true), sha256: enabled ? null : event.raw.sha256 } : null,
    diagnostics: event.diagnostics.map(d => ({ ...d })), match,
    redaction: { enabled, changed: false, displayTruncated: label !== exportedLabel } };
  value.redaction.changed = changed;
  const cap = representative ? limits.representative : limits.projection;
  const size = () => Buffer.byteLength(canonical(value));
  const truncate = () => { value.redaction.displayTruncated = true; };
  if (representative || size() > cap) { if (Object.keys(value.attributes).length) truncate(); value.attributes = {}; }
  if (representative && value.raw !== null) { value.raw = null; truncate(); }
  if (size() > cap && value.raw !== null) { value.raw.text = ''; value.raw.complete = false; truncate(); }
  const shorten = (get: () => string, set: (text: string) => void) => {
    if (size() <= cap) return;
    const original = get(); truncate(); let lo = 0; let hi = Buffer.byteLength(original);
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); set(prefix(original, mid) + '[TRUNCATED]'); if (size() <= cap) lo = mid; else hi = mid - 1; }
    set(prefix(original, lo) + '[TRUNCATED]');
  };
  shorten(() => value.message, x => { value.message = x; });
  if (value.timestamp) { const time = value.timestamp; shorten(() => time.original, x => { time.original = x; }); }
  shorten(() => value.severityOriginal ?? '', x => { value.severityOriginal = x; });
  shorten(() => value.source.label, x => { value.source.label = x; });
  for (const field of ['service', 'logger'] as const) shorten(() => value[field] ?? '', x => { value[field] = x; });
  for (const field of ['requestId', 'traceId', 'spanId'] as const) shorten(() => value.correlation[field] ?? '', x => { value.correlation[field] = x; });
  if (size() > cap) throw new AppError('OUTPUT_LIMIT');
  return value;
}
export function protectedValue(value: string, enabled: boolean): string {
  const result: Json = protectJson(value, enabled);
  if (typeof result !== 'string') throw new AppError('INTERNAL_INVARIANT'); return result;
}
