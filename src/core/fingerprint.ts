import { createHash } from 'node:crypto';
import type { Parsed } from '../contracts/model.js';
import { canonical } from './json.js';

export const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
export function groupable(parsed: Parsed): boolean {
  for (const code of parsed.codes) {
    if (code === 'UNKNOWN_SEVERITY' || code === 'INVALID_TIME' || code === 'AMBIGUOUS_TIME') continue;
    if (code === 'CONFLICTING_FIELDS' || code === 'INVALID_FIELD' || code === 'INVALID_NUMBER' || code === 'FIELD_TOO_LARGE') {
      if (parsed.event.diagnostics.filter(d => d.code === code).every(d => d.field === 'timestamp' || d.field === 'requestId' || d.field === 'traceId' || d.field === 'spanId')) continue;
    }
    return false;
  }
  return true;
}
export function fingerprint(parsed: Parsed): string {
  const event = parsed.event; const lines = event.message.split('\n'); const first = (lines.shift() ?? '').replace(/[ \t]+$/, '');
  if (typeof event.attributes.stack === 'string') lines.push(...event.attributes.stack.split('\n'));
  const frames: string[] = []; const seen = new Set<string>(); const rest: string[] = [];
  for (const line of lines) {
    const clean = line.replace(/[ \t]+$/, '');
    const js = clean.trimStart().startsWith('at ') && /:\d+:\d+\)?$/.test(clean);
    const python = /^[ \t]*File "[^"]+", line \d+(?:, in .+)?$/.test(clean);
    const java = /^[ \t]*at [\w.$]+\([^\n()]+\.java:\d+\)$/.test(clean);
    const frame = js || python || java;
    const normalized = js ? clean.replace(/:\d+:\d+(\)?)$/, ':<line>:<column>$1') : python ? clean.replace(/, line \d+(?=,|$)/, ', line <line>') : java ? clean.replace(/:\d+\)$/, ':<line>)') : clean;
    if (frame && seen.has(clean)) continue;
    if (frame) seen.add(clean);
    if (frame && frames.length < 3) frames.push(normalized); else rest.push(normalized);
  }
  const evidence = event.message + '\n' + (typeof event.attributes.stack === 'string' ? event.attributes.stack : '');
  // Tokenize first, then check the delimiter: a failed colon match must not rescan a long dotted identifier.
  const tokens = evidence.matchAll(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g);
  let exception: string | null = null;
  for (const token of tokens) {
    const value = token[0];
    if (/\w/.test(evidence[token.index - 1] ?? '') || (!value.endsWith('Error') && !value.endsWith('Exception'))) continue;
    let end = token.index + value.length; while (evidence[end] === ' ' || evidence[end] === '\t') end++;
    if (evidence[end] === ':') { exception = value; break; }
  }
  return canonical(['loglens.fingerprint.v1', event.service, event.logger, event.severity, first, exception,
    frames.length ? frames : null, rest.length ? digest(canonical(rest)) : null]);
}
