import type { Command, ErrorCode, GroupMode, IdKind, LogEvent, Severity, Source } from './model.js';

export interface ProjectedEvent extends Omit<LogEvent, 'raw'> {
  raw: (Omit<LogEvent['raw'], 'sha256'> & { sha256: string | null }) | null;
  redaction: { enabled: boolean; changed: boolean; displayTruncated: boolean };
  match: 'match' | 'context';
}
export type Project = (event: LogEvent, match: ProjectedEvent['match'], representative?: boolean) => ProjectedEvent;
export interface SourceOutcome extends Source {
  status: 'complete' | 'partial' | 'failed'; bytesRead: number; eventsRead: number; damagedEvents: number; errors: ErrorCode[];
}
export interface Group {
  key: string; mode: GroupMode; value: string | null; count: number; representative: ProjectedEvent;
  firstSeen: string | null; lastSeen: string | null;
}
export interface Correlation extends Omit<Group, 'mode'> { kind: IdKind }
export interface Timeline { start: string; end: string | null; count: number; severity: Record<Severity, number> }
export interface Result {
  schemaVersion: 'loglens.output.v1'; command: Command; coverage: 'complete' | 'partial';
  redaction: { enabled: boolean; policyVersion: 1 }; issues: string[];
  stats: { bytesRead: number; physicalLines: number; blankLines: number; eventsRead: number; damagedEvents: number;
    selectedEvents: number; matchedEvents: number | null; emittedMatches: number | null; contextEvents: number | null;
    timeExcludedMissing: number; diagnosticCounts: Record<string, number> };
  sources: SourceOutcome[];
  summary: { severity: Record<Severity, number>; earliest: string | null; latest: string | null; timedEvents: number; untimedEvents: number };
  events: ProjectedEvent[]; groups: Group[]; correlations: Correlation[]; timeline: Timeline[];
  analysis: { groupingMode: GroupMode | null; overflowGroupEvents: number; overflowCorrelationMemberships: number;
    overflowTimelineEvents: number; ungroupableEvents: number; uncorrelatedEvents: number; displayTruncated: boolean };
}
