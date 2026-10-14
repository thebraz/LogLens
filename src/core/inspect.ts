import { addCount } from '../contracts/model.js';
import type { ErrorCode, Parsed, Severity, Source } from '../contracts/model.js';

export interface SourceOutcome extends Source {
  status: 'complete' | 'partial' | 'failed'; bytesRead: number; eventsRead: number; damagedEvents: number; errors: ErrorCode[];
}
export function createInspection(source: Source) {
  const severity: Record<Severity, number> = { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0, unknown: 0 };
  const stats = { bytesRead: 0, physicalLines: 0, blankLines: 0, eventsRead: 0, damagedEvents: 0,
    selectedEvents: 0, matchedEvents: null, emittedMatches: null, contextEvents: null, timeExcludedMissing: 0,
    diagnosticCounts: Object.create(null) as Record<string, number> };
  let earliest: number | null = null; let latest: number | null = null; let timedEvents = 0;
  const outcome: SourceOutcome = { ...source, status: 'complete', bytesRead: 0, eventsRead: 0, damagedEvents: 0, errors: [] };
  return {
    blank() { stats.blankLines = addCount(stats.blankLines); },
    accept(parsed: Parsed) {
      stats.eventsRead = addCount(stats.eventsRead); stats.selectedEvents = addCount(stats.selectedEvents);
      severity[parsed.event.severity] = addCount(severity[parsed.event.severity]);
      if (parsed.damaged) stats.damagedEvents = addCount(stats.damagedEvents);
      for (const code of parsed.codes) stats.diagnosticCounts[code] = addCount(stats.diagnosticCounts[code] ?? 0);
      const time = parsed.event.timestamp?.epochMs;
      if (time !== undefined) {
        timedEvents = addCount(timedEvents); earliest = earliest === null ? time : Math.min(earliest, time);
        latest = latest === null ? time : Math.max(latest, time);
      }
    },
    finish(bytesRead: number, physicalLines: number, error: ErrorCode | null) {
      stats.bytesRead = bytesRead; stats.physicalLines = physicalLines;
      outcome.bytesRead = bytesRead; outcome.eventsRead = stats.eventsRead; outcome.damagedEvents = stats.damagedEvents;
      if (error !== null) outcome.errors.push(error);
      outcome.status = error !== null || stats.damagedEvents > 0 ? (bytesRead > 0 || stats.eventsRead > 0 ? 'partial' : 'failed') : 'complete';
      return {
        schemaVersion: 'loglens.output.v1', command: 'inspect', coverage: outcome.status === 'complete' ? 'complete' : 'partial',
        redaction: { enabled: true, policyVersion: 1 }, issues: [], stats, sources: [outcome],
        summary: { severity, earliest: earliest === null ? null : new Date(earliest).toISOString(),
          latest: latest === null ? null : new Date(latest).toISOString(), timedEvents, untimedEvents: stats.eventsRead - timedEvents },
        events: [], groups: [], correlations: [], timeline: [], analysis: { groupingMode: null, overflowGroupEvents: 0,
          overflowCorrelationMemberships: 0, overflowTimelineEvents: 0, ungroupableEvents: 0, uncorrelatedEvents: 0, displayTruncated: false }
      };
    }
  };
}
export type Inspection = ReturnType<ReturnType<typeof createInspection>['finish']>;
