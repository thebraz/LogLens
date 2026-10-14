import type { IdKind, LogEvent, Plan } from '../contracts/model.js';

export const idFields = { request: 'requestId', trace: 'traceId', span: 'spanId' } as const satisfies Record<IdKind, keyof LogEvent['correlation']>;
export function selected(event: LogEvent, plan: Plan): { selected: boolean; timeMissing: boolean } {
  const timeMissing = (plan.since !== null || plan.until !== null) && event.timestamp === null;
  const time = event.timestamp?.epochMs;
  return { timeMissing, selected: !timeMissing &&
    (plan.since === null || (time !== undefined && time >= plan.since)) &&
    (plan.until === null || (time !== undefined && time < plan.until)) &&
    (!plan.levels.length || plan.levels.includes(event.severity)) &&
    (!plan.sources.length || plan.sources.some(x => /^s\d{6}$/.test(x) ? x === event.source.id : x === event.source.label)) &&
    (plan.service === null || plan.service === event.service) &&
    (!plan.ids.length || plan.ids.some(x => event.correlation[idFields[x.kind]] === x.value)) };
}
export const asciiFold = (value: string): string => value.replace(/[A-Z]/g, c => c.toLowerCase());
export function matches(event: LogEvent, plan: Pick<Plan, 'query' | 'ignoreCase'>): boolean {
  return plan.ignoreCase ? asciiFold(event.message).includes(asciiFold(plan.query)) : event.message.includes(plan.query);
}
