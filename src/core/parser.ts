import { limits } from '../contracts/model.js';
import type { EventCode, Json, Line, LogEvent, Parsed, Plan, Severity, Source } from '../contracts/model.js';
import { canonical, codePointCompare, prefix } from './json.js';
import { parseTime } from './time.js';

const levelMap: Readonly<Record<string, Severity>> = {
  TRACE: 'trace', DEBUG: 'debug', INFO: 'info', INFORMATION: 'info', WARN: 'warn', WARNING: 'warn',
  ERROR: 'error', ERR: 'error', FATAL: 'fatal', CRITICAL: 'fatal', CRIT: 'fatal'
};
export function severity(value: string | number): Severity {
  return Object.hasOwn(levelMap, String(value).trim().replace(/[a-z]/g, c => c.toUpperCase()))
    ? levelMap[String(value).trim().replace(/[a-z]/g, c => c.toUpperCase())] ?? 'unknown' : 'unknown';
}
export function detectFormat(text: string, format: Plan['format']): 'jsonl' | 'text' {
  return format === 'jsonl' || (format === 'auto' && /^[ \t]*\{/.test(text)) ? 'jsonl' : 'text';
}
const aliases = {
  timestamp: ['timestamp', 'time', 'ts'], severity: ['level', 'severity'], message: ['message', 'msg'],
  service: ['service', 'serviceName'], logger: ['logger', 'loggerName'],
  requestId: ['requestId', 'request_id'], traceId: ['traceId', 'trace_id'], spanId: ['spanId', 'span_id']
} as const;
const promoted = new Set<string>(Object.values(aliases).flat());
const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
const badNumber = (value: unknown): boolean => typeof value === 'number' &&
  (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)));

export function parseLine(line: Line, source: Source, ordinal: number, plan: Pick<Plan, 'format' | 'assumeTimezone'>): Parsed {
  const event: LogEvent = {
    schemaVersion: 'loglens.event.v1', id: `${source.id}:e${ordinal}`, source, position: line.position,
    timestamp: null, severity: 'unknown', severityOriginal: null, message: '', service: null, logger: null,
    correlation: { requestId: null, traceId: null, spanId: null }, attributes: {},
    raw: { text: line.text, complete: line.complete, byteLength: line.byteLength, sha256: line.sha256 },
    format: 'text', diagnostics: []
  };
  const codes = new Set<EventCode>(); const seen = new Set<string>();
  const diagnostic = (code: EventCode, field: string | null = null): void => {
    codes.add(code); const key = `${code}:${field ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (event.diagnostics.length < limits.diagnostics - 1) event.diagnostics.push({ code, line: line.position.lineStart, field });
    else if (!codes.has('DIAGNOSTICS_LIMIT')) {
      codes.add('DIAGNOSTICS_LIMIT'); event.diagnostics.push({ code: 'DIAGNOSTICS_LIMIT', line: line.position.lineStart, field: null });
    }
  };
  const unicode = (value: string, field: string): string => value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, () => {
    diagnostic('INVALID_UNICODE', field); return '\uFFFD';
  });
  const capped = (value: string, bytes: number, field: string, discard = false): string | null => {
    const clean = unicode(value, field);
    if (Buffer.byteLength(clean) <= bytes) return clean;
    diagnostic('FIELD_TOO_LARGE', field); return discard ? null : prefix(clean, bytes);
  };
  const setTime = (value: unknown): void => {
    if (typeof value !== 'string' && typeof value !== 'number') diagnostic('INVALID_FIELD', 'timestamp');
    if (badNumber(value)) diagnostic('INVALID_NUMBER', 'timestamp');
    const result = parseTime(value, plan.assumeTimezone);
    event.timestamp = result.timestamp;
    if (result.code) diagnostic(result.code, 'timestamp');
  };
  const setLevel = (value: unknown): void => {
    if (badNumber(value)) { diagnostic('INVALID_NUMBER', 'severity'); diagnostic('INVALID_FIELD', 'severity'); return; }
    if (typeof value !== 'string' && typeof value !== 'number') { diagnostic('INVALID_FIELD', 'severity'); return; }
    event.severity = severity(value);
    event.severityOriginal = capped(String(value), limits.message, 'severityOriginal');
    if (event.severity === 'unknown') diagnostic('UNKNOWN_SEVERITY', 'severity');
  };
  if (line.invalidUtf8) diagnostic('INVALID_UTF8');
  if (line.sourceTruncated) diagnostic('SOURCE_TRUNCATED');
  if (!line.complete) {
    diagnostic('LINE_TOO_LARGE'); event.message = capped(line.text, limits.message, 'message') ?? '';
  } else {
    let object: object | null = null;
    if (detectFormat(line.text, plan.format) === 'jsonl') {
      try {
        const value: unknown = JSON.parse(line.text);
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) object = value;
        else diagnostic('NON_OBJECT_JSON');
      } catch { diagnostic('MALFORMED_JSON'); }
    }
    if (object !== null) {
      event.format = 'jsonl';
      const choose = (field: keyof typeof aliases): unknown => {
        let selected: unknown = null; let selectedSpelling: string | null = null;
        for (const key of aliases[field]) {
          if (!Object.hasOwn(object, key)) continue;
          const value: unknown = Reflect.get(object, key);
          if (value === null) continue;
          // Raw spelling avoids recursive equality on untrusted, possibly deep metadata.
          let spelling: string;
          try { spelling = JSON.stringify(value); }
          catch { spelling = `unserializable:${key}`; diagnostic('INVALID_FIELD', field); }
          if (selectedSpelling === null) { selected = value; selectedSpelling = spelling; }
          else if (spelling !== selectedSpelling) diagnostic('CONFLICTING_FIELDS', field);
        }
        return selected;
      };
      const time = choose('timestamp'); if (time !== null) setTime(time);
      const level = choose('severity'); if (level !== null) setLevel(level);
      const message = choose('message');
      if (message === null) diagnostic('MISSING_MESSAGE', 'message');
      else if (typeof message !== 'string') { diagnostic('INVALID_FIELD', 'message'); if (badNumber(message)) diagnostic('INVALID_NUMBER', 'message'); }
      else event.message = capped(message, limits.message, 'message') ?? '';
      for (const field of ['service', 'logger', 'requestId', 'traceId', 'spanId'] as const) {
        const value = choose(field); let normalized: string | null = null;
        if (value !== null && typeof value !== 'string') {
          diagnostic('INVALID_FIELD', field); if (badNumber(value)) diagnostic('INVALID_NUMBER', field);
        } else if (typeof value === 'string' && value.trim()) normalized = capped(value, field === 'service' || field === 'logger' ? 256 : 512, field, true);
        if (field === 'service' || field === 'logger') event[field] = normalized;
        else event.correlation[field] = normalized;
      }
      const attributes: { [key: string]: Json } = Object.create(null) as { [key: string]: Json };
      const queue: { input: object; output: { [key: string]: Json } | Json[]; depth: number; root: boolean }[] = [
        { input: object, output: attributes, depth: 0, root: true }
      ];
      let nodes = 0; let metadataInvalid = false;
      while (queue.length && !metadataInvalid) {
        const current = queue.pop(); if (!current) break;
        if (current.depth > limits.depth) { diagnostic('METADATA_LIMIT'); metadataInvalid = true; break; }
        for (const key of Object.keys(current.input)) {
          if (current.root && promoted.has(key)) continue;
          nodes++;
          if (nodes > limits.nodes) { diagnostic('METADATA_LIMIT'); metadataInvalid = true; break; }
          if (unsafe.has(key)) { diagnostic('UNSAFE_KEY'); continue; }
          const value: unknown = Reflect.get(current.input, key); let clean: Json;
          if (badNumber(value)) { diagnostic('INVALID_NUMBER'); metadataInvalid = true; break; }
          if (typeof value === 'string') clean = unicode(value, 'attributes');
          else if (typeof value === 'boolean' || typeof value === 'number' || value === null) clean = value;
          else if (typeof value === 'object') {
            clean = Array.isArray(value) ? [] : Object.create(null) as { [key: string]: Json };
            queue.push({ input: value, output: clean, depth: current.depth + 1, root: false });
          } else { metadataInvalid = true; diagnostic('INVALID_FIELD', 'attributes'); break; }
          Object.defineProperty(current.output, unicode(key, 'attributes'), { value: clean, enumerable: true, writable: true, configurable: true });
        }
      }
      if (!metadataInvalid && Buffer.byteLength(canonical(attributes)) > limits.metadata) { metadataInvalid = true; diagnostic('METADATA_LIMIT'); }
      event.attributes = metadataInvalid ? {} : attributes;
    } else {
      // Malformed explicit JSON is evidence, never a second clean interpretation.
      let rest = line.text;
      if (!codes.has('MALFORMED_JSON') && !codes.has('NON_OBJECT_JSON')) {
        const time = /^[ \t]*(?:\[(\d{4}-\d{2}-\d{2}[T ][^\]]+)\]|(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^ \t]*))(?=[ \t]|$)/.exec(rest);
        if (time) { setTime(time[1] ?? time[2]); rest = rest.slice(time[0].length).replace(/^[ \t]+/, ''); }
        const level = /^[ \t]*(?:\[([^\]]+)\]|([^ \t]+))(?=[ \t]|$)/.exec(rest);
        const token = level?.[1] ?? level?.[2];
        if (token !== undefined && (level?.[1] !== undefined || severity(token) !== 'unknown')) {
          setLevel(token); rest = rest.slice(level?.[0].length ?? 0).replace(/^[ \t]+/, '');
        }
        if (time || (token !== undefined && event.severityOriginal !== null)) rest = rest.replace(/^-[ \t]+/, '');
      }
      event.message = capped(rest, limits.message, 'message') ?? '';
    }
  }
  event.diagnostics.sort((a, b) => a.line - b.line || codePointCompare(a.code, b.code) || codePointCompare(a.field ?? '', b.field ?? ''));
  return { event, codes, damaged: [...codes].some(code => code !== 'UNKNOWN_SEVERITY') };
}
