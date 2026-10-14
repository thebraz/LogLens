import { AppError, limits, severities } from '../contracts/model.js';
import type { ProjectedEvent, Result } from '../contracts/output.js';

export function renderText(result: Result): string {
  const s = result.stats; const summary = result.summary;
  const losses = [...result.issues, ...result.sources.flatMap(x => x.errors), ...Object.keys(s.diagnosticCounts).filter(code => code.includes('LIMIT') || code.includes('TOO_LARGE'))];
  return [
    `Coverage: ${result.coverage}`, `Redaction: ${result.redaction.enabled ? 'enabled' : 'disabled'} (policy 1)`, `Events read: ${s.eventsRead}`,
    `Selected events: ${s.selectedEvents}`, `Damaged events: ${s.damagedEvents}`,
    `Timed events: ${summary.timedEvents}`, `Untimed events: ${summary.untimedEvents}`,
    `Earliest: ${summary.earliest ?? 'n/a'}`, `Latest: ${summary.latest ?? 'n/a'}`, 'Severity:',
    ...severities.map(level => `  ${level}: ${summary.severity[level]}`), 'Sources:',
    ...result.sources.map(source => `  ${source.id}\t${source.label}\t${source.status}\tevents=${source.eventsRead}\tdamaged=${source.damagedEvents}`),
    'Diagnostics:', ...Object.keys(s.diagnosticCounts).sort().map(code => `  ${code}: ${s.diagnosticCounts[code]}`),
    ...(Object.keys(s.diagnosticCounts).length ? [] : ['  none']),
    `Limits: ${[...new Set(losses)].sort().join(', ') || 'none'}`
  ].join('\n') + '\n';
}
const cell = (value: string) => value.replaceAll('\\u000a', '\\n').replaceAll('\\u000d', '\\r').replaceAll('\\u0009', '\\t');
export function renderEvent(event: ProjectedEvent): string {
  return [event.match, event.id, event.source.id, `${event.position.lineStart}-${event.position.lineEnd}`,
    event.timestamp?.isoUtc ?? 'n/a', event.severity, cell(event.message)].join('\t') + '\n';
}
export function renderCommand(result: Result): string {
  let output = renderText(result);
  if (result.command === 'search') output += `Matches: ${result.stats.matchedEvents}\nEmitted matches: ${result.stats.emittedMatches}\nContext events: ${result.stats.contextEvents}\nDisplay truncated: ${result.analysis.displayTruncated}\nSelection uses original content before redaction.\n`;
  if (result.command === 'group') {
    output += 'Groups:\n' + result.groups.map(g => [g.key, g.count, g.firstSeen ?? 'n/a', g.lastSeen ?? 'n/a', g.value ?? 'n/a', g.representative.id, cell(g.representative.message)].join('\t')).join('\n') + '\n';
    output += `Overflow group events: ${result.analysis.overflowGroupEvents}\nOverflow correlation memberships: ${result.analysis.overflowCorrelationMemberships}\nUngroupable events: ${result.analysis.ungroupableEvents}\nUncorrelated events: ${result.analysis.uncorrelatedEvents}\nDisplay truncated: ${result.analysis.displayTruncated}\n`;
  }
  return output;
}
const noEvidence = 'No evidence in selected events';
export function reportSections(result: Result): [string, string][] {
  const analysis = result.analysis;
  return [
    ['Coverage and protection', `Coverage: ${result.coverage}\nRedaction: ${result.redaction.enabled ? 'enabled' : 'disabled'} (policy 1)\nSelection uses original content before redaction.`],
    ['Overview', renderText(result).split('Sources:')[0] ?? ''],
    ['Sources and diagnostics', renderText(result).split('Sources:')[1] ?? noEvidence],
    ['Error groups', result.groups.length ? result.groups.map(g => `${g.key}\tcount=${g.count}\t${g.firstSeen ?? 'n/a'} — ${g.lastSeen ?? 'n/a'}\n${g.representative.id}\tservice=${g.representative.service ?? 'n/a'}\tlogger=${g.representative.logger ?? 'n/a'}\n${g.representative.message}`).join('\n\n') : noEvidence],
    ['Correlation evidence', result.correlations.length ? result.correlations.map(g => `${g.key}\t${g.value ?? 'n/a'}\tcount=${g.count}\t${g.firstSeen ?? 'n/a'} — ${g.lastSeen ?? 'n/a'}\n${g.representative.id}\t${g.representative.message}`).join('\n\n') : noEvidence],
    ['Timeline', result.timeline.length ? result.timeline.map(b => `${b.start}\t${b.end ?? 'n/a'}\tcount=${b.count}\t${severities.map(s => `${s}=${b.severity[s]}`).join(' ')}`).join('\n') : noEvidence],
    ['Limitations', `Pattern redaction can miss arbitrary PII, custom, encoded or fragmented secrets and short provider prefixes.\nFingerprint digests reveal equality and can permit guesses for low-entropy templates.\nUntimed selected events: ${result.summary.untimedEvents}\nInput coverage: ${result.coverage}; damaged events: ${result.stats.damagedEvents}\nIssues: ${result.issues.join(', ') || 'none'}\nOverflow group events: ${analysis.overflowGroupEvents}\nOverflow correlation memberships: ${analysis.overflowCorrelationMemberships}\nOverflow timeline events: ${analysis.overflowTimelineEvents}\nUngroupable errors: ${analysis.ungroupableEvents}; events without identifiers: ${analysis.uncorrelatedEvents}\nDisplay clipping/omitted rows: ${analysis.displayTruncated}\nRankings are among admitted groups; saturation can omit more frequent groups.\nShared identifiers are correlation evidence, not inferred causes or a verified root cause.\nOnly documented multiline/UTF-8 grammars are recognized; same-size source overwrites are not detectable.`]
  ];
}
export function escapeHtml(text: string): string {
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += 16 * 1024) {
    chunks.push(text.slice(start, start + 16 * 1024).replace(/[&<>"']/g,
      c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));
  }
  return chunks.join('');
}
export function renderReport(result: Result, format: 'html' | 'markdown', cap: number = limits.aggregate): string {
  const sections = reportSections(result);
  if (format === 'html') {
    const header = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;"><title>LogLens report</title><style>body{font:16px system-ui;max-width:1100px;margin:2rem auto;padding:1rem;color:#17212b;background:#fff}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #ccc;padding:1rem}h2{margin-top:2rem}</style></head><body><h1>LogLens report</h1>\n';
    const footer = '\n</body></html>\n';
    let size = Buffer.byteLength(header + footer) + Math.max(0, sections.length - 1);
    for (const [title, text] of sections) {
      size += Buffer.byteLength(`<section><h2>${title}</h2><pre></pre></section>`) + Buffer.byteLength(text);
      if (size > cap) throw new AppError('OUTPUT_LIMIT');
      for (const char of text) {
        size += char === '&' ? 4 : char === '<' || char === '>' ? 3 : char === '"' ? 5 : char === "'" ? 4 : 0;
        if (size > cap) throw new AppError('OUTPUT_LIMIT');
      }
    }
    return header + sections.map(([title, text]) => `<section><h2>${title}</h2><pre>${escapeHtml(text)}</pre></section>`).join('\n') + footer;
  }
  const output = '# LogLens report\n\n' + sections.map(([title, text]) => {
    let longest = 0; for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `## ${title}\n\n${fence}text\n${text}\n${fence}\n`;
  }).join('\n');
  if (Buffer.byteLength(output) > cap) throw new AppError('OUTPUT_LIMIT');
  return output;
}
