import { addCount, limits } from '../contracts/model.js';
import type { IdKind, Parsed, Plan, Severity } from '../contracts/model.js';
import type { Correlation, Group, Project, Result, SourceOutcome, Timeline } from '../contracts/output.js';
import { canonical, codePointCompare } from './json.js';
import { digest, fingerprint, groupable } from './fingerprint.js';
import { idFields, selected } from './filter.js';

export const severityCounts = (): Record<Severity, number> => ({ trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0, unknown: 0 });
export function createAnalysis(plan: Plan, project: Project, protectValue: (value: string) => string,
  policy: { keys: number; bytes: number } = { keys: limits.keys, bytes: limits.stateBytes }, hash = digest) {
  const result: Result = { schemaVersion: 'loglens.output.v1', command: plan.command, coverage: 'complete', redaction: { enabled: plan.redact, policyVersion: 1 }, issues: [],
    stats: { bytesRead: 0, physicalLines: 0, blankLines: 0, eventsRead: 0, damagedEvents: 0, selectedEvents: 0,
      matchedEvents: plan.command === 'search' ? 0 : null, emittedMatches: plan.command === 'search' ? 0 : null,
      contextEvents: plan.command === 'search' ? 0 : null, timeExcludedMissing: 0, diagnosticCounts: Object.create(null) as Record<string, number> },
    sources: [], summary: { severity: severityCounts(), earliest: null, latest: null, timedEvents: 0, untimedEvents: 0 },
    events: [], groups: [], correlations: [], timeline: [], analysis: { groupingMode: plan.command === 'report' ? 'fingerprint' : plan.command === 'group' ? plan.by : null,
      overflowGroupEvents: 0, overflowCorrelationMemberships: 0, overflowTimelineEvents: 0, ungroupableEvents: 0, uncorrelatedEvents: 0, displayTruncated: false } };
  const errors = new Map<string, { tuple: string; row: Group }[]>();
  const identifiers = new Map<string, { value: string; row: Correlation }>();
  const buckets = new Map<number, Timeline>();
  const ordinals = { request: 0, trace: 0, span: 0 };
  let errorKeys = 0; let retainedBytes = 0;
  const issue = (code: string) => { if (!result.issues.includes(code)) result.issues.push(code); result.coverage = 'partial'; };
  const admit = (count: number, value: unknown) => {
    // Reserve growth from null bounds and zero counters through their maximum serialized widths.
    const size = Buffer.byteLength(canonical(value)) + 512 + 128;
    if (count >= policy.keys || size > policy.bytes - retainedBytes) { issue('AGGREGATION_LIMIT'); return false; }
    retainedBytes += size; return true;
  };
  const bounds = (row: { count: number; firstSeen: string | null; lastSeen: string | null }, time: string | null) => {
    row.count = addCount(row.count);
    if (time !== null) { if (row.firstSeen === null || time < row.firstSeen) row.firstSeen = time; if (row.lastSeen === null || time > row.lastSeen) row.lastSeen = time; }
  };
  const fingerprintEvent = (parsed: Parsed) => {
    const event = parsed.event;
    if (event.severity !== 'error' && event.severity !== 'fatal') return;
    if (!groupable(parsed)) { result.analysis.ungroupableEvents = addCount(result.analysis.ungroupableEvents); return; }
    const tuple = fingerprint(parsed); const key = hash(tuple); const collisions = errors.get(key) ?? [];
    const found = collisions.find(x => x.tuple === tuple);
    if (found) { bounds(found.row, event.timestamp?.isoUtc ?? null); return; }
    if (errorKeys >= policy.keys) { issue('AGGREGATION_LIMIT'); result.analysis.overflowGroupEvents = addCount(result.analysis.overflowGroupEvents); return; }
    const representative = project(event, 'context', true);
    const row: Group = { key: collisions.length ? `${key}:${collisions.length + 1}` : key, mode: 'fingerprint', value: null,
      count: 0, representative, firstSeen: null, lastSeen: null };
    if (!admit(errorKeys, { digest: key, tuple, row })) { result.analysis.overflowGroupEvents = addCount(result.analysis.overflowGroupEvents); return; }
    if (collisions.length) issue('HASH_COLLISION');
    errorKeys++; collisions.push({ tuple, row }); errors.set(key, collisions); bounds(row, event.timestamp?.isoUtc ?? null);
    result.analysis.displayTruncated ||= representative.redaction.displayTruncated;
  };
  const correlate = (parsed: Parsed, kinds: IdKind[]) => {
    const event = parsed.event; let present = false;
    for (const kind of kinds) {
      const value = event.correlation[idFields[kind]]; if (value === null) continue; present = true;
      const key = canonical([kind, value]); const found = identifiers.get(key);
      if (found) { bounds(found.row, event.timestamp?.isoUtc ?? null); continue; }
      if (identifiers.size >= policy.keys) { issue('AGGREGATION_LIMIT'); result.analysis.overflowCorrelationMemberships = addCount(result.analysis.overflowCorrelationMemberships); continue; }
      const representative = project(event, 'context', true);
      const row: Correlation = { key: `${kind}:g${ordinals[kind] + 1}`, kind, value: protectValue(value), count: 0, representative, firstSeen: null, lastSeen: null };
      if (!admit(identifiers.size, { key, value, row })) { result.analysis.overflowCorrelationMemberships = addCount(result.analysis.overflowCorrelationMemberships); continue; }
      ordinals[kind]++; identifiers.set(key, { value, row }); bounds(row, event.timestamp?.isoUtc ?? null);
      result.analysis.displayTruncated ||= representative.redaction.displayTruncated;
    }
    if (!present) result.analysis.uncorrelatedEvents = addCount(result.analysis.uncorrelatedEvents);
  };
  const category = (parsed: Parsed, mode: 'severity' | 'source') => {
    const event = parsed.event; const tuple = mode === 'severity' ? event.severity : event.source.id;
    const key = `${mode}:${tuple}`; const found = errors.get(key)?.[0];
    if (found) { bounds(found.row, event.timestamp?.isoUtc ?? null); return; }
    const representative = project(event, 'context', true);
    const row: Group = { key, mode, value: mode === 'severity' ? event.severity : representative.source.label,
      count: 0, representative, firstSeen: null, lastSeen: null };
    if (!admit(errorKeys, { key, tuple, row })) { result.analysis.overflowGroupEvents = addCount(result.analysis.overflowGroupEvents); return; }
    errorKeys++; errors.set(key, [{ tuple, row }]); bounds(row, event.timestamp?.isoUtc ?? null);
    result.analysis.displayTruncated ||= representative.redaction.displayTruncated;
  };
  const timeline = (parsed: Parsed) => {
    const time = parsed.event.timestamp?.epochMs; if (time === undefined) return;
    const width = plan.bucket === '1m' ? 60000 : plan.bucket === '1h' ? 3600000 : 86400000;
    const start = Math.floor(time / width) * width; let row = buckets.get(start);
    if (!row) {
      const end = start + width;
      row = { start: new Date(start).toISOString(), end: end > 253402300799999 ? null : new Date(end).toISOString(), count: 0, severity: severityCounts() };
      if (!admit(buckets.size, row)) { result.analysis.overflowTimelineEvents = addCount(result.analysis.overflowTimelineEvents); return; }
      buckets.set(start, row);
    }
    row.count = addCount(row.count); row.severity[parsed.event.severity] = addCount(row.severity[parsed.event.severity]);
  };
  return { result, issue, blank() { result.stats.blankLines = addCount(result.stats.blankLines); },
    accept(parsed: Parsed, source: SourceOutcome): boolean {
      const s = result.stats; const event = parsed.event;
      s.eventsRead = addCount(s.eventsRead); source.eventsRead = addCount(source.eventsRead);
      if (parsed.damaged) { s.damagedEvents = addCount(s.damagedEvents); source.damagedEvents = addCount(source.damagedEvents); result.coverage = 'partial'; }
      for (const code of parsed.codes) s.diagnosticCounts[code] = addCount(s.diagnosticCounts[code] ?? 0);
      const selection = selected(event, plan); if (selection.timeMissing) s.timeExcludedMissing = addCount(s.timeExcludedMissing);
      if (!selection.selected) return false;
      s.selectedEvents = addCount(s.selectedEvents); result.summary.severity[event.severity] = addCount(result.summary.severity[event.severity]);
      const time = event.timestamp?.isoUtc;
      if (time !== undefined) { result.summary.timedEvents = addCount(result.summary.timedEvents);
        if (result.summary.earliest === null || time < result.summary.earliest) result.summary.earliest = time;
        if (result.summary.latest === null || time > result.summary.latest) result.summary.latest = time;
      } else result.summary.untimedEvents = addCount(result.summary.untimedEvents);
      if (plan.command === 'group' || plan.command === 'report') {
        if (result.analysis.groupingMode === 'fingerprint') fingerprintEvent(parsed);
        if (plan.command === 'report') { correlate(parsed, ['request', 'trace', 'span']); timeline(parsed); }
        else if (plan.by === 'severity' || plan.by === 'source') category(parsed, plan.by);
        else if (plan.by !== 'fingerprint') correlate(parsed, [plan.by === 'request-id' ? 'request' : plan.by === 'trace-id' ? 'trace' : 'span']);
      }
      return true;
    },
    finish() {
      const ranked = [...errors.values()].flat().sort((a,b) => b.row.count - a.row.count || codePointCompare(a.tuple,b.tuple));
      result.groups = ranked.slice(0, plan.top).map(x => x.row);
      const kinds: IdKind[] = ['request', 'trace', 'span'];
      const correlations = [...identifiers.values()].sort((a,b) => b.row.count - a.row.count || kinds.indexOf(a.row.kind) - kinds.indexOf(b.row.kind) || codePointCompare(a.value,b.value));
      if (plan.command === 'group' && (plan.by === 'request-id' || plan.by === 'trace-id' || plan.by === 'span-id')) result.groups = correlations.slice(0, plan.top).map(({ row }) => ({ key: row.key, value: row.value,
        count: row.count, representative: row.representative, firstSeen: row.firstSeen, lastSeen: row.lastSeen, mode: plan.by }));
      if (plan.command === 'report') {
        const counts = { request: 0, trace: 0, span: 0 };
        result.correlations = correlations.filter(x => ++counts[x.row.kind] <= plan.top).map(x => x.row);
      }
      result.analysis.displayTruncated ||= ranked.length > plan.top || (plan.command === 'group' && correlations.length > plan.top) ||
        (plan.command === 'report' && kinds.some(kind => correlations.filter(x => x.row.kind === kind).length > plan.top));
      result.timeline = [...buckets.entries()].sort(([a],[b]) => a-b).map(([,row]) => row);
      result.issues.sort(codePointCompare); return result;
    },
    retainedBytes: () => retainedBytes
  };
}
