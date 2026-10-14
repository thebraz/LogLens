import { addCount, AppError, limits } from '../contracts/model.js';
import type { LogEvent, Plan } from '../contracts/model.js';
import type { Project, ProjectedEvent, Result } from '../contracts/output.js';
import { matches } from './filter.js';
import { canonical } from './json.js';

export function createSearch(plan: Plan, result: Result, project: Project, emit: (event: ProjectedEvent) => Promise<void>) {
  const before: { value: ProjectedEvent | null; emitted: boolean; bytes: number }[] = [];
  let after = 0; let bytes = 0;
  const output = async (value: ProjectedEvent) => {
    await emit(value); result.analysis.displayTruncated ||= value.redaction.displayTruncated;
    if (value.match === 'match') result.stats.emittedMatches = addCount(result.stats.emittedMatches ?? 0);
    else result.stats.contextEvents = addCount(result.stats.contextEvents ?? 0);
  };
  return {
    boundary() { before.length = 0; after = 0; bytes = 0; },
    async accept(event: LogEvent, selected: boolean) {
      const match = selected && matches(event, plan);
      if (match) result.stats.matchedEvents = addCount(result.stats.matchedEvents ?? 0);
      const anchor = match && (result.stats.matchedEvents ?? 0) <= plan.limit;
      const value = selected && (!match || anchor) ? project(event, match ? 'match' : 'context') : null;
      let emitted = false;
      if (anchor) {
        for (const previous of before) if (!previous.emitted && previous.value) { await output(previous.value); previous.emitted = true; }
        if (value) { await output(value); emitted = true; }
        after = plan.after;
      } else {
        if (after > 0 && value) { await output(value); emitted = true; }
        if (after > 0) after--;
        if (match) result.analysis.displayTruncated = true;
      }
      if (plan.before > 0) {
        const size = value ? Buffer.byteLength(canonical(value)) + 512 : 512;
        before.push({ value, emitted, bytes: size }); bytes += size;
        if (before.length > plan.before) { const old = before.shift(); bytes -= old?.bytes ?? 0; }
        if (bytes > limits.contextBytes) throw new AppError('OUTPUT_LIMIT');
      }
    }
  };
}
