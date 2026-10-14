# Public CLI contract

Owner of arguments, public output, and process status. Full functional Stage 2 options are implemented, including explicitly authorized severity/source grouping (D16). Stage 1 availability below is historical. See [Stage 2 acceptance](STAGE_2_ACCEPTANCE.md) and the [JSON Schema](../schemas/loglens.output.v1.schema.json). Machine output schema: `loglens.output.v1`. Executed checks and limitations: [Stage 1 acceptance](STAGE_1_ACCEPTANCE.md).

## Syntax and stage availability

`loglens <inspect|search|group|report> [inputs...] [options]`

`search` requires `--query <literal>`. Inputs are literal paths or `-` for stdin; a path beginning with `-` requires `--` before positional inputs (options MUST precede that delimiter). No positional search pattern. No inputs means stdin, but if stdin is a TTY the command fails usage immediately rather than waiting. Explicit `-` permits interactive stdin. No interactive questions.

| Capability | Stage 1 | Stage 2 |
| --- | --- | --- |
| `inspect`, one plain file or stdin; text/JSON summaries | Required | Retained |
| Basic one-line JSONL/text, auto/explicit format | Required | Retained |
| Timestamp parsing, normalization, safe default projection, fixed limits | Required | Retained |
| Multiple files, gzip, multiline, common filters | Reject unsupported options/inputs with exit 2 | Required |
| `search`, `group`, `report`, context and analysis | Commands recognized but return `NOT_AVAILABLE` exit 2 | Required |

Stage 1 supports only `--format`, `--output-format text|json`, `--output`, `--assume-timezone`, `--help`, and `--version`. It MUST reject Stage 2 flags instead of ignoring them. Stage 1 help MUST state available behavior. Safety/resource limits are mandatory from Stage 1 even when functionality is narrower.

## Arguments and flags (full V1)

Long options support `--name value` and `--name=value`. No short aliases or combined switches. Boolean options take no value. Repeated scalar options, unknown options, empty required strings, and invalid enums/numbers are usage errors. Only explicitly repeatable flags may repeat. Options are case-sensitive. Integer option syntax is unsigned decimal with no exponent, sign, or leading whitespace; zero is valid only where the range permits it. Leading zeros are accepted. --id values are limited to 512 UTF-8 bytes; --service to 256. Repeated list members are deduplicated; list whitespace is invalid.

| Flag | Commands | Default and semantics |
| --- | --- | --- |
| `--help` | Global/each | Help to stdout, exit 0, no input access; help takes precedence over ordinary validation |
| `--version` | Global only | Package semantic version plus LF, exit 0, no input access; combining with a command is invalid |
| `--format auto|jsonl|text` | All | `auto`; parser selection |
| `--output-format <format>` | All | `text` for inspect/search/group; `markdown` for report |
| `--output <path>` | All | stdout when absent; new file only, safe atomic commit; `-` means stdout |
| `--assume-timezone UTC|±HH:mm` | All | Absent; apply fixed offset only to zone-less input times; `-00:00` rejected |
| `--level <list>` | All | No filter; comma-separated canonical levels including unknown; no empty items |
| `--since <time>` | All | Inclusive timestamp lower bound; explicit offset required |
| `--until <time>` | All | Exclusive upper bound; explicit offset required |
| `--source <label-or-id>` | All | Repeatable OR of exact basename labels or `sNNNNNN` IDs |
| `--service <string>` | All | Exact case-sensitive service match |
| `--id <kind:value>` | All | Repeatable OR; kind `request`, `trace`, `span`; split first colon only, nonempty exact value |
| `--query <literal>` | Search only | Required, nonempty, max 4096 UTF-8 bytes; literal message substring |
| `--ignore-case` | Search only | ASCII A–Z folding only; otherwise case-sensitive |
| `--before <n>`, `--after <n>` | Search only | 0 each; integers 0–100 |
| `--limit <n>` | Search only | 100 matches rendered; 1–1000000; continue scanning to count all matches |
| `--by fingerprint|severity|source|request-id|trace-id|span-id` | Group only | `fingerprint`; severity/source/explicit ID modes include all selected levels |
| `--top <n>` | Group/report | 20; 1–10000 admitted groups rendered; not an aggregation-memory limit |
| `--bucket 1m|1h|1d` | Report only | `1h`, UTC aligned temporal counts |
| `--include-raw` | Search JSON/NDJSON only | False; export raw projection, subject to redaction/display cap |
| `--no-redact` | All | False; MUST be paired with acknowledgement below |
| `--ack-sensitive-output` | All | False; required exactly when no-redact is set; no prompt/environment substitute |

Output formats: inspect `text|json`; search `text|json|ndjson`; group `text|json`; report `markdown|html|json`. Any other command/flag/format combination is exit 2. `--since >= --until` is invalid. Fixed timezone grammar/ranges follow [DATA_CONTRACT](DATA_CONTRACT.md). CLI time bounds never inherit `--assume-timezone`. Regexes, implicit shell expansion, config files, environment defaults, and hidden network configuration are not V1 features.

## Input selection and ordering

Resolve files relative to the current directory. Deduplicate normalized absolute path spellings before assigning source IDs, case-insensitively on Windows and case-sensitively elsewhere. Hard links/distinct names remain distinct. `-` may occur once. Process sources sequentially in argument order; source IDs include failed sources and are stable for that invocation. Source labels are basenames (stdin is `stdin`); IDs disambiguate duplicate names. A --source token matching `s` plus six digits selects only that source ID; other tokens select all exact matching labels. Directories, devices, FIFOs, sockets, and symlinks are rejected. Failure of one source permits later sources.

For files, gzip is recognized by first two magic bytes `1f 8b`, regardless of extension. A `.gz` file lacking gzip magic is `GZIP_INVALID`, not plain fallback. Stdin uses magic detection; no extension. Concatenated gzip members are supported and treated as one decompressed stream. Trailing nongzip bytes are invalid. Stage 1 rejects gzip magic/`.gz` before parsing with `NOT_AVAILABLE`. Security checks and opened-size behavior follow [SECURITY_MODEL](SECURITY_MODEL.md) and [PARSING_SPEC](PARSING_SPEC.md).

Events are processed/emitted by source then event ordinal; there is no global timestamp sort. Aggregate sorting follows [ANALYSIS_ENGINE](ANALYSIS_ENGINE.md). Text output is monochrome, UTF-8/LF, locale-independent, has no cursor control, terminal-width adaptation, or progress animation. Diagnostics go only to stderr. No-match search emits empty results and a valid summary.

## Filtering and partial results

Filter families combine with AND; values in repeatable source/ID and level lists combine with OR. Time-filtered events with null timestamps are excluded and counted in `timeExcludedMissing`. Other missing fields fail their relevant filter. Unknown severity matches only explicit unknown or no level filter. Source selection never opens an unrequested path.

All read/parsed counters refer to the entire consumed input before filters. Selected counters refer to after common filters; matched counts refer to selected events satisfying the search query. Context cannot bypass common filters, though an excluded intervening event still consumes a context position. Search/display limits MUST NOT stop reading; set `displayTruncated`, not partial coverage. Aggregation saturation/parser damage/read failures set partial coverage. Default commands still emit usable partial results and return exit 3.

## Public machine schemas

JSON is one object plus LF, recursively sorted object keys, with these always-present fields:

| Field | Shape |
| --- | --- |
| `schemaVersion` | `loglens.output.v1` |
| `command` | `inspect`, `search`, `group`, `report` |
| `coverage` | `complete` or `partial`; independent of output display truncation |
| `redaction` | `{ enabled: boolean, policyVersion: 1 }` |
| `issues` | Sorted unique run-level codes, including aggregation saturation or hash collision; `[]` when none |
| `stats` | Counters described below |
| `sources` | Source outcome objects in source order |
| `summary` | `{ severity, earliest, latest, timedEvents, untimedEvents }`; selected events only; earliest/latest UTC string or null |
| `events` | Search projected event array; otherwise `[]` |
| `groups` | Selected mode groups; inspect/search `[]`; report error fingerprints |
| `correlations` | Report identifier summaries; otherwise `[]` |
| `timeline` | Report time buckets; otherwise `[]` |
| `analysis` | `{ groupingMode, overflowGroupEvents, overflowCorrelationMemberships, overflowTimelineEvents, ungroupableEvents, uncorrelatedEvents, displayTruncated }`; groupingMode null except group/report (report uses fingerprint); unused numeric counters are 0 |

`stats` always contains `bytesRead` (decompressed consumed bytes), `physicalLines`, `blankLines`, `eventsRead`, `damagedEvents`, `selectedEvents`, `matchedEvents` (null outside search), `emittedMatches` (null outside search), `contextEvents` (null outside search), `timeExcludedMissing`, and `diagnosticCounts` (code→event count). Summary severity has all seven canonical keys with exact integer counts. `eventsRead = sum(all unfiltered severity counts)` is an internal invariant; exported summary counts sum to `selectedEvents`. Diagnostic counts count each code once per event; source-only failures are in source outcomes, not event diagnostics.

Source outcome: `{ id, label, kind, status, bytesRead, eventsRead, damagedEvents, errors }`; status `complete|partial|failed`; errors sorted unique safe codes. Failed means no bytes/events were consumed; partial means some evidence was consumed but coverage is incomplete. Recoverable damaged events also make their source partial. Empty valid files are complete.

Projected event: all canonical event fields except `raw` is null unless include-raw; add `redaction: { enabled, changed, displayTruncated }` and `match: "match"|"context"`. Projection may shorten text or clear attributes, always marking displayTruncated; positions, counters, severity, timestamp numeric/UTC, and event ID remain. Raw export includes its completeness/length/hash, but a display-shortened raw prefix sets `complete=false` in the exported projection. Hash is omitted under default protection as specified in security (represented by null). Group representatives use `match="context"` to mean illustrative evidence, never search matches.

Group shape: `{ key, mode, value, count, representative, firstSeen, lastSeen }`; key is fingerprint digest (optional collision suffix), `severity:<canonical level>`, `source:<source ID>`, or namespaced encounter key; value is null for fingerprints, canonical level for severity, protected source label for source, protected identifier for ID modes; mode is a --by value; timestamp bounds are UTC/null among members. Correlation shape: `{ key, kind, value, count, firstSeen, lastSeen, representative }`; kind is request/trace/span, key is namespaced encounter key, value is the protected identifier. Timeline shape: `{ start, end, count, severity }`; UTC start inclusive/end exclusive, seven severity counters. Selection, ranking, overflow accuracy, and representative rules are in [ANALYSIS_ENGINE](ANALYSIS_ENGINE.md).

Temporal bucket end is null only when its exclusive boundary exceeds supported year 9999; bucket arithmetic/counts remain exact. All other bucket starts/ends are UTC strings. No out-of-range date string is fabricated.

--top applies to the machine arrays as well as human reports: group/groups retains its first ranked N; report/groups its first ranked N fingerprints; report/correlations its first ranked N per namespace. Omitted admitted rows set analysis.displayTruncated=true. Representative clipping and any event projection clipping also set that flag, independently of coverage. Timeline includes every admitted bucket.

NDJSON search emits: one `type="start"` record with schemaVersion/command/redaction; zero or more `type="event"` records with `event`; one `type="summary"` record with `result` containing the JSON envelope with `events=[]`. Every NDJSON record has schemaVersion and type. JSON search MUST buffer only emitted projected matches/context in memory up to the 32 MiB retention cap, then serialize one canonical envelope. It MUST fail output with exit 4 if retention or final serialization exceeds the cap; no disk spool or original-event history is allowed. NDJSON is the large-output choice.

stderr uses human `loglens: CODE: safe description` lines in text/Markdown/HTML mode, and NDJSON `{schemaVersion,type:"diagnostic",code,sourceId,message}` in JSON/NDJSON mode. Unexpected exception details MUST NOT leak. One summary per source/code prevents per-line stderr flooding; full event code counts remain in output. Validation errors produce no stdout. Source failures with all inputs unreadable still produce a valid empty aggregate envelope and exit 4. Write failure/interruption may prevent any complete machine envelope; consumers MUST check process status and NDJSON summary presence.

## Human output and report sections

Human prose is not a machine schema, but section order, populations, and essential evidence are binding. All values use the same protected projection as machine output. Null human fields print `n/a`; severity order is trace/debug/info/warn/error/fatal/unknown. Text summaries MUST print the following labels in this order: `Coverage`, `Redaction`, `Events read`, `Selected events`, `Damaged events`, `Timed events`, `Untimed events`, `Earliest`, `Latest`, `Severity`, `Sources`, `Diagnostics`, `Limits`. Counts are base-10 integers without locale separators; timestamp strings are UTC. Sources print source ID, protected label, status, and event/damage counts. Diagnostics list code/count in code-point order; Limits identifies active losses/overflow or `none`.

Inspect emits only that summary. Search emits one line per projected event, with columns `match|context`, event ID, source ID, `lineStart-lineEnd`, UTC or `n/a`, severity, and safely escaped message, separated by tabs; multiline messages are displayed with visible `\\n`. It ends with the summary plus `Matches`, `Emitted matches`, `Context events`, `Display truncated`. Group emits the summary then `Groups`, with ranked rows containing key, count, firstSeen, lastSeen, protected identifier when applicable, and representative event ID/message; it prints overflow/ungroupable/uncorrelated counts even when zero.

Markdown/HTML reports MUST contain sections in this order: `LogLens report`, `Coverage and protection`, `Overview`, `Sources and diagnostics`, `Error groups`, `Correlation evidence`, `Timeline`, `Limitations`. Overview uses the selected summary. Error groups use --top representatives; correlation evidence renders up to --top buckets per namespace from the shared admitted map; timeline renders all admitted buckets. Empty sections say `No evidence in selected events`. Limitations includes known redaction misses, null-time count, partial input/overflow, display clipping, admitted-only ranking if saturated, and the statement that shared identifiers are correlation rather than inferred causes. Reports MUST include no generation clock, interactive script, or external asset.

## Stable diagnostic codes

Codes are enum strings; human descriptions may improve without echoing unsafe values. Parser event codes: `INVALID_UTF8`, `INVALID_UNICODE`, `INVALID_NUMBER`, `MALFORMED_JSON`, `NON_OBJECT_JSON`, `INVALID_TIME`, `AMBIGUOUS_TIME`, `UNKNOWN_SEVERITY`, `MISSING_MESSAGE`, `INVALID_FIELD`, `CONFLICTING_FIELDS`, `UNSAFE_KEY`, `ORPHAN_CONTINUATION`, `LINE_TOO_LARGE`, `EVENT_TOO_LARGE`, `FIELD_TOO_LARGE`, `METADATA_LIMIT`, `DIAGNOSTICS_LIMIT`, `SOURCE_TRUNCATED`. Informational/damage classification is owned by [PARSING_SPEC](PARSING_SPEC.md).

Source errors: `INPUT_NOT_FOUND`, `INPUT_PERMISSION`, `INPUT_READ`, `UNSAFE_PATH`, `UNSUPPORTED_ENCODING`, `SOURCE_TRUNCATED`, `GZIP_INVALID`, `SOURCE_BYTE_LIMIT`, `GZIP_RATIO_LIMIT`, `NOT_AVAILABLE`. Run issues: `RUN_BYTE_LIMIT`, `AGGREGATION_LIMIT`, `HASH_COLLISION`. Terminal errors: `USAGE`, `NOT_AVAILABLE`, `UNSAFE_OUTPUT`, `OUTPUT_EXISTS`, `OUTPUT_WRITE`, `OUTPUT_LIMIT`, `INTERNAL_INVARIANT`, `INTERRUPTED`. EPIPE is quiet. New codes require documented compatibility review. Source/run limit failures never create a fabricated event solely to carry an error; attach diagnostics to an actual pending damaged event when evidence exists.

D18 also applies SOURCE_BYTE_LIMIT/RUN_BYTE_LIMIT to independent encoded-gzip byte caps. Public bytesRead remains decoded consumed bytes; no compressed header bytes are relabeled as decoded evidence. Default protection fixes do not change the output schema or fingerprint algorithm version.

## Exit status and interruption

| Code | Meaning |
| --- | --- |
| 0 | Complete successful result, including empty inspect/group/report |
| 1 | Complete search with zero matches |
| 2 | Usage, unsupported Stage 1 feature, invalid option/combination |
| 3 | Usable partial coverage: damaged input, source failures with some consumed evidence, or aggregation limits |
| 4 | I/O/security failure with no usable input, unsafe output, output failure, or internal invariant failure |
| 130 | SIGINT |
| 143 | SIGTERM where supported |
| 141 | Closed stdout pipe (EPIPE), without noisy stack/error repetition |

Precedence: interruption/EPIPE terminal cause; otherwise fatal output/internal error 4; otherwise usage 2 (validated before input); otherwise partial 3; otherwise search no-match 1; otherwise 0. No input read successfully plus source failures = 4, even if zero-byte source outcomes are present; a successfully read empty source does count as usable input for this rule.

On cancellation, stop reading, close streams, discard uncommitted output file, and return the signal code. Stdout bytes already written remain; NDJSON SHOULD emit an interrupted diagnostic when writable but MUST NOT emit a normal complete summary. Aggregate JSON/HTML/Markdown may be absent/incomplete. File results commit only for statuses 0/1/3, with partial clearly labeled; destination collisions are never overwritten.

## Examples

`loglens inspect app.log --output-format json` — Stage 1: normalized severity/time/quality summary, no event list.

`loglens search app.log archived.gz --query "connection refused" --level error,fatal --before 2 --after 2 --output-format ndjson` — Stage 2: exact literal matches and eligible same-source context, source-order emission, final counts.

`loglens group export.jsonl --by request-id --top 10` — exact explicit request-ID buckets across selected events, never a causal explanation.

`loglens report app.log --since 2026-10-13T00:00:00Z --until 2026-10-14T00:00:00Z --bucket 1h --output-format html --output incident.html` — new static redacted file, UTC day range, null-time events excluded and counted.

`loglens search - --query "failed" --include-raw --no-redact --ack-sensitive-output --output-format json` — explicitly authorized sensitive raw projection, still subject to safe escaping and display limits. It does not promise byte-identical original export.

Package semver and output/event schema majors are separate identifiers. Breaking CLI defaults/options/statuses or machine meanings require package major version after 1.0. See [RELEASE_SPEC](RELEASE_SPEC.md).
