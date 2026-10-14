import { AppError } from '../contracts/model.js';

export function codePointCompare(a: string, b: string): number {
  let left = 0; let right = 0;
  while (left < a.length && right < b.length) {
    const l = a.codePointAt(left) ?? 0; const r = b.codePointAt(right) ?? 0;
    if (l !== r) return l - r;
    left += l > 65535 ? 2 : 1; right += r > 65535 ? 2 : 1;
  }
  return (a.length - left) - (b.length - right);
}
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((v: unknown) => canonical(v)).join(',') + ']';
  if (typeof value === 'object' && value !== null) {
    return '{' + Object.keys(value).sort(codePointCompare).map(key =>
      JSON.stringify(key) + ':' + canonical(Reflect.get(value, key))).join(',') + '}';
  }
  throw new AppError('INTERNAL_INVARIANT');
}
export function prefix(value: string, bytes: number): string {
  if (Buffer.byteLength(value) <= bytes) return value;
  let units = 0; let used = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char);
    if (used + size > bytes) break;
    units += char.length; used += size;
  }
  // Copy once: per-character concatenation retains ropes far larger than the accounted prefix.
  return Buffer.from(value.slice(0, units), 'utf16le').toString('utf16le');
}
