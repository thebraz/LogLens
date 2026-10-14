import type { EventCode, Timestamp } from '../contracts/model.js';

export function offsetMinutes(zone: string): number | null {
  if (zone === 'UTC' || zone === 'Z') return 0;
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
  if (!m || zone === '-00:00') return null;
  const hours = Number(m[2]); const minutes = Number(m[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  return (hours * 60 + minutes) * (m[1] === '-' ? -1 : 1);
}
export function parseTime(value: unknown, assumed: string | null): { timestamp: Timestamp | null; code: EventCode | null } {
  const invalid = { timestamp: null, code: 'INVALID_TIME' } as const;
  let epochMs: number; let interpretation: Timestamp['interpretation'];
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return invalid;
    epochMs = value; interpretation = 'epoch-ms';
  } else if (typeof value === 'string') {
    const m = /^(\d{4})[-](\d{2})[-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
    if (!m) return invalid;
    const year = Number(m[1]); const month = Number(m[2]); const day = Number(m[3]);
    const hour = Number(m[4]); const minute = Number(m[5]); const second = Number(m[6]);
    const ms = Number((m[7] ?? '').padEnd(3, '0'));
    if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return invalid;
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, ms);
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return invalid;
    const zone = m[8] ?? assumed;
    if (zone === null) return { timestamp: null, code: 'AMBIGUOUS_TIME' };
    const offset = offsetMinutes(zone);
    if (offset === null) return invalid;
    epochMs = date.getTime() - offset * 60000;
    interpretation = m[8] ? 'explicit-offset' : 'assumed-offset';
  } else return invalid;
  const date = new Date(epochMs);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return invalid;
  return { timestamp: { epochMs, isoUtc: date.toISOString(), original: String(value), interpretation }, code: null };
}
