import { createHash } from 'node:crypto';
import { addCount, AppError, limits } from '../contracts/model.js';
import type { EventCode, Line, Parsed, Plan, Source } from '../contracts/model.js';
import { codePointCompare, prefix } from './json.js';
import { detectFormat, parseLine, severity } from './parser.js';

function header(text: string): boolean {
  if (/^[ \t]*(?:\[\d{4}-\d{2}-\d{2}[T ][^\]]+\]|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^ \t]*)(?=[ \t]|$)/.test(text) || /^[ \t]*\[[^\]]+\](?=[ \t]|$)/.test(text)) return true;
  const token = /^[ \t]*([^ \t]+)/.exec(text)?.[1];
  return token !== undefined && severity(token) !== 'unknown';
}
function continuation(text: string, marked: boolean): boolean {
  return /^[ \t]/.test(text) || /^(?:Caused by:|Suppressed:|Traceback \(most recent call last\):|During handling of the above exception|at )/.test(text) ||
    /^\.\.\. \d+ more/.test(text) || (marked && /^(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*(?:Error|Exception)(?::|$)/.test(text));
}
function addDiagnostic(parsed: Parsed, code: EventCode, line: number, field: string | null = null): void {
  const codes = new Set(parsed.codes); codes.add(code);
  parsed.codes = codes; parsed.damaged = true;
  const diagnostics = parsed.event.diagnostics;
  if (diagnostics.some(d => d.code === code && d.line === line && d.field === field)) return;
  if (diagnostics.length < limits.diagnostics - 1) diagnostics.push({ code, line, field });
  else if (!codes.has('DIAGNOSTICS_LIMIT')) { codes.add('DIAGNOSTICS_LIMIT'); diagnostics.push({ code: 'DIAGNOSTICS_LIMIT', line, field: null }); }
}
export async function* parseRecords(lines: AsyncIterable<Line>, source: Source, plan: Pick<Plan, 'format' | 'assumeTimezone'>,
  blank: () => void): AsyncGenerator<Parsed> {
  let pending: Parsed | null = null; let ordinal = 0; let hash = createHash('sha256'); let separator = ''; let marked = false;
  const flush = (): Parsed | null => {
    if (!pending) return null;
    const result = pending;
    if (result.event.raw.complete) result.event.raw.text = result.event.raw.text.slice(0, result.event.raw.text.length - separator.length);
    result.event.raw.sha256 = hash.digest('hex');
    result.event.diagnostics.sort((a,b) => a.line - b.line || codePointCompare(a.code,b.code) || codePointCompare(a.field ?? '',b.field ?? ''));
    pending = null; marked = false; return result;
  };
  try {
    for await (const line of lines) {
      if (/^[ \t\v\f\r]*$/.test(line.text) && line.complete && !line.invalidUtf8) { const value = flush(); if (value) yield value; blank(); continue; }
      const isContinuation = plan.format !== 'jsonl' && detectFormat(line.text, plan.format) === 'text' && !header(line.text) && continuation(line.text, marked);
      if (pending && isContinuation && line.complete) {
        const event = pending.event; const raw = event.raw;
        if (line.bytes) hash.update(line.bytes);
        raw.byteLength = addCount(raw.byteLength, line.byteLength); event.position.lineEnd = line.position.lineEnd; event.position.byteEnd = line.position.byteEnd;
        if (raw.byteLength > limits.event) { raw.complete = false; raw.text = prefix(raw.text, limits.prefix); addDiagnostic(pending, 'EVENT_TOO_LARGE', line.position.lineStart); }
        separator = line.bytes?.at(-1) === 10 ? (line.bytes.at(-2) === 13 ? '\r\n' : '\n') : '';
        if (raw.complete) raw.text += line.text + separator;
        if (Buffer.byteLength(event.message) < limits.message) {
          const message = event.message + '\n' + line.text;
          event.message = prefix(message, limits.message);
          if (Buffer.byteLength(message) > limits.message) addDiagnostic(pending, 'FIELD_TOO_LARGE', line.position.lineStart, 'message');
        } else addDiagnostic(pending, 'FIELD_TOO_LARGE', line.position.lineStart, 'message');
        if (line.invalidUtf8) addDiagnostic(pending, 'INVALID_UTF8', line.position.lineStart);
        if (line.sourceTruncated) addDiagnostic(pending, 'SOURCE_TRUNCATED', line.position.lineStart);
        marked ||= /(?:Error|Exception|Traceback)/.test(line.text);
        continue;
      }
      const value = flush(); if (value) yield value;
      ordinal = addCount(ordinal);
      const parsed = parseLine(line, source, ordinal, plan);
      if (isContinuation) addDiagnostic(parsed, 'ORPHAN_CONTINUATION', line.position.lineStart);
      if (plan.format === 'jsonl' || detectFormat(line.text, plan.format) === 'jsonl' || !line.complete) { yield parsed; continue; }
      pending = parsed; hash = createHash('sha256'); if (line.bytes) hash.update(line.bytes);
      separator = line.bytes?.at(-1) === 10 ? (line.bytes.at(-2) === 13 ? '\r\n' : '\n') : '';
      pending.event.raw.text += separator;
      marked = /(?:Error|Exception|Traceback)/.test(line.text);
    }
  } catch (error) {
    if (error instanceof AppError && error.code === 'INTERRUPTED') throw error;
    if (pending) addDiagnostic(pending, 'SOURCE_TRUNCATED', pending.event.position.lineEnd);
    const value = flush(); if (value) yield value;
    throw error;
  }
  const value = flush(); if (value) yield value;
}
