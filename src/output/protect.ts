import type { Json } from '../contracts/model.js';
import { prefix } from '../core/json.js';

const sensitive = new Set(['password', 'passwd', 'pwd', 'secret', 'clientsecret', 'token', 'accesstoken',
  'refreshtoken', 'idtoken', 'apikey', 'authorization', 'proxyauthorization', 'cookie', 'setcookie',
  'privatekey', 'connectionstring', 'dsn']);
const normalizedKey = (key: string): string => key.replace(/[A-Z]/g, c => c.toLowerCase()).replace(/[_ -]/g, '');
function quotedEnd(text: string, start: number): number {
  const quote = text[start]; let end = start + 1;
  while (end < text.length) {
    if (text[end] === '\\') { end += 2; continue; }
    if (text[end++] === quote) break;
  }
  return Math.min(end, text.length);
}
function valueEnd(text: string, start: number): number {
  if (text[start] === '\\' && (text[start + 1] === '"' || text[start + 1] === "'")) return text.length;
  if (text[start] === '"' || text[start] === "'") return quotedEnd(text, start);
  let end = start;
  if (text[start] === '[' || text[start] === '{') {
    let depth = 0;
    while (end < text.length) {
      const char = text[end];
      if (char === '"' || char === "'") { end = quotedEnd(text, end); continue; }
      end++;
      if (char === '[' || char === '{') depth++;
      if ((char === ']' || char === '}') && --depth === 0) break;
    }
  } else while (end < text.length && !/[\s,;]/.test(text[end] ?? '')) end++;
  return end;
}
function replaceSpans(text: string, spans: [number, number][]): string {
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const parts: string[] = []; let at = 0; let start = -1; let end = -1;
  for (const span of spans) {
    if (span[0] <= end) { end = Math.max(end, span[1]); continue; }
    if (start >= 0) { parts.push(text.slice(at, start), '[REDACTED]'); at = end; }
    [start, end] = span;
  }
  if (start >= 0) { parts.push(text.slice(at, start), '[REDACTED]'); at = end; }
  parts.push(text.slice(at)); return parts.join('');
}
export function redact(text: string, incomplete = false): string {
  const spans: [number, number][] = [];
  const scan = (pattern: RegExp, group = 0): void => {
    for (const match of text.matchAll(pattern)) {
      const value = match[group];
      if (value !== undefined) { const end = match.index + match[0].length; spans.push([end - value.length, end]); }
    }
  };
  let from = 0;
  while (from < text.length) {
    const begin = text.indexOf('-----BEGIN ', from); if (begin < 0) break;
    const headerEnd = text.indexOf('-----', begin + 11);
    if (headerEnd < 0) break;
    const headingEnd = headerEnd + 5;
    const heading = text.slice(begin + 11, headerEnd);
    if (heading !== 'PRIVATE KEY' && !heading.endsWith(' PRIVATE KEY')) { from = headingEnd; continue; }
    const marker = `-----END ${heading}-----`;
    const end = text.indexOf(marker, headingEnd);
    const stop = end < 0 ? text.length : end + marker.length;
    spans.push([begin, stop]); from = stop;
  }
  scan(/\b(?:proxy-authorization|authorization|set-cookie|cookie)[ \t]*:[ \t]*([^\r\n]*)/gi, 1);
  // Consume maximal tokens once; failed suffixes never restart an unbounded regex.
  for (const match of text.matchAll(/[A-Za-z0-9+.-]+/g)) {
    const end = match.index + match[0].length;
    if (!/^[A-Za-z]/.test(match[0]) || !text.startsWith('://', end)) continue;
    const start = end + 3; let at = start; let colon = false;
    while (at < text.length && !/[\s/@]/.test(text[at] ?? '')) { colon ||= text[at] === ':'; at++; }
    if (colon && (text[at] === '@' || (incomplete && at === text.length))) spans.push([start, at + (text[at] === '@' ? 1 : 0)]);
  }
  let previousDelimiter = -1;
  for (let at = 0; at < text.length; at++) {
    if (text[at] !== ':' && text[at] !== '=') continue;
    let end = at - 1; while (end > previousDelimiter && /[ \t]/.test(text[end] ?? '')) end--;
    if (text[end] === '"' || text[end] === "'") end--;
    let key = ''; let accepted = false;
    for (let k = end; k > previousDelimiter && /[A-Za-z_ -]/.test(text[k] ?? ''); k--) {
      const char = text[k] ?? '';
      if (/[A-Za-z]/.test(char)) key = char.toLowerCase() + key;
      if (key.length > 20) break;
      if (sensitive.has(key) && (k === previousDelimiter + 1 || !/[A-Za-z_-]/.test(text[k - 1] ?? ''))) { accepted = true; break; }
    }
    previousDelimiter = at;
    if (!accepted) continue;
    let start = at + 1; while (/[ \t]/.test(text[start] ?? '') && start < text.length) start++;
    if (text.startsWith('[REDACTED]', start) || text.startsWith('"[REDACTED]"', start) || text.startsWith("'[REDACTED]'", start)) continue;
    const stop = valueEnd(text, start); spans.push([start, stop]); at = stop - 1;
  }
  scan(/\bBearer[ \t]+([^\s]+)/gi, 1);
  scan(/\b(?:sk-|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{16,}/g);
  const segments: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/[A-Za-z0-9_-]+/g)) {
    const segment = { start: match.index, end: match.index + match[0].length };
    const previous = segments.at(-1);
    if (!previous || segment.start !== previous.end + 1 || text[previous.end] !== '.') segments.length = 0;
    segments.push(segment); if (segments.length > 3) segments.shift();
    if (segments.length === 3 && segments.every((s, i) => s.end - s.start >= 8 || (incomplete && i === 2 && s.end === text.length))) {
      const first = segments[0]; if (first) spans.push([first.start, segment.end]);
    }
  }
  if (incomplete) scan(/\b(?:sk-|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]*$/g);
  return replaceSpans(text, spans);
}
export function redactJsonText(text: string, incomplete = false): string {
  const parts: string[] = []; let copied = 0;
  for (let at = 0; at < text.length; at++) {
    if (text[at] !== '"') continue;
    const end = quotedEnd(text, at); let decoded: unknown;
    try { decoded = JSON.parse(text.slice(at, end)); }
    catch {
      if (end === text.length && text[end - 1] !== '"') {
        for (let drop = 0; drop <= 6 && end - drop > at; drop++) {
          try { decoded = JSON.parse(text.slice(at, end - drop) + '"'); break; } catch { /* bounded partial escape repair */ }
        }
      }
      if (typeof decoded !== 'string') { at = end - 1; continue; }
    }
    if (typeof decoded !== 'string') continue;
    let next = end; while (next < text.length && /\s/.test(text[next] ?? '')) next++;
    if (text[next] === ':' && sensitive.has(normalizedKey(decoded))) {
      let start = next + 1; while (start < text.length && /\s/.test(text[start] ?? '')) start++;
      const stop = valueEnd(text, start);
      parts.push(text.slice(copied, start), '"[REDACTED]"'); copied = stop; at = stop - 1;
    } else {
      const protectedText = redact(decoded, incomplete && end === text.length);
      if (protectedText !== decoded) { parts.push(text.slice(copied, at), JSON.stringify(protectedText)); copied = end; }
      at = end - 1;
    }
  }
  parts.push(text.slice(copied)); return redact(parts.join(''), incomplete);
}
export function escapeControls(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
    c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
export function protectedLabel(value: string, enabled = true): string { return prefix(escapeControls(enabled ? redact(value) : value), 256); }
export function protectJson(value: Json, enabled = true): Json {
  if (typeof value === 'string') return escapeControls(enabled ? redact(value) : value);
  if (Array.isArray(value)) return value.map(x => protectJson(x, enabled));
  if (value !== null && typeof value === 'object') {
    const result: { [key: string]: Json } = Object.create(null) as { [key: string]: Json };
    for (const key of Object.keys(value)) {
      const protectedKey = escapeControls(enabled ? redact(key) : key); let exportedKey = protectedKey; let suffix = 2;
      while (Object.hasOwn(result, exportedKey)) exportedKey = `${protectedKey}:${suffix++}`;
      Object.defineProperty(result, exportedKey, {
        value: enabled && sensitive.has(normalizedKey(key)) ? '[REDACTED]' : protectJson(value[key] ?? null, enabled), enumerable: true, configurable: true
      });
    }
    return result;
  }
  return value;
}
