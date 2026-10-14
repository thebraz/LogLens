# LogLens beta user contract

0.1.0-beta.1 is an experimental Windows 11 x64 / Node.js 24.x beta candidate.
Linux and macOS are not validated or supported by this beta. Native file I/O is
required; missing/incompatible images return NOT_AVAILABLE without pathname fallback.
Windows uses retained handles. The original multiplatform Stage 4 remains PARTIAL;
its platform requirements remain mandatory. See RELEASE_NOTES.md for release status.

Version0.1.0-beta.1; output `loglens.output.v1`, events `loglens.event.v1`, fingerprints `loglens.fingerprint.v1`, redaction policy1. The beta is not production-ready. Its npm package has not been published. This standalone contract accompanies the package; source engineering/history are excluded from the archive.

## Invocation

`loglens <inspect|search|group|report> [inputs...] [options]`

Long options accept `--name=value` or `--name value`; booleans have no value. No short aliases, regex, glob discovery, config/environment defaults. Unknown/repeated scalar options, empty required strings and invalid combinations fail2. Help takes precedence over ordinary validation and accesses no input. Version is global only. Options precede positional `--` for dash filenames. No inputs selects piped stdin; explicit `-` may occur once and permits interactive input.

| Option | Availability / behavior |
| --- | --- |
| `--help` | Global/command; stdout,0 |
| `--version` | Global only; package version plus LF |
| `--format` | All: auto(default),jsonl,text |
| `--output-format` | inspect/group:text/json; search:text/json/ndjson; report:markdown/html/json |
| `--output` | All: new file/existing parent; absent or - =stdout |
| `--assume-timezone` | All: UTC/±HH:mm for naive input only |
| `--level` | All: comma-separated trace,debug,info,warn,error,fatal,unknown |
| `--since` | All: inclusive explicit-offset time |
| `--until` | All: exclusive explicit-offset time, greater than since |
| `--source` | All,repeatable: exact basename or sNNNNNN |
| `--service` | All: exact case-sensitive string,max256 UTF-8 bytes |
| `--id` | All,repeatable: request:value/trace:value/span:value; first colon splits,max512 bytes/value |
| `--query` | Search: required nonempty literal message substring,max4096 bytes |
| `--ignore-case` | Search: ASCII A–Z folding |
| `--before` | Search:0–100 preceding events,default0 |
| `--after` | Search:0–100 following events,default0 |
| `--limit` | Search:1–1000000 rendered matches,default100; count all |
| `--by` | Group:fingerprint(default),severity,source,request-id,trace-id,span-id |
| `--top` | Group/report:1–10000 displayed admitted groups,default20; report IDs per namespace |
| `--bucket` | Report:UTC1m/1h(default)/1d,epoch-aligned |
| `--include-raw` | Search JSON/NDJSON: bounded protected decoded projection |
| `--no-redact` | All: patterns disabled only with acknowledgement |
| `--ack-sensitive-output` | All: required exactly when no-redact supplied |

Default output:text except report:Markdown. Numbers use unsigned decimal digits, without sign/exponent/whitespace. Families combine AND; level/source/ID values combine OR. Missing evidence fails active filters; null times increment timeExcludedMissing before other filters. Command/format/option restrictions are usage errors.

## Parsing and evidence

Regular files only; unsafe components/symlinks/junctions are rejected where detected. Paths resolve/deduplicate case-insensitively on Windows; hard links/distinct names stay distinct. Sources follow argument order including failures, with stable run-local sNNNNNN IDs; events use source:eN IDs. Basename labels omit absolute paths. Events remain source/event ordered, without content deduplication or global time sorting.

UTF-8 only: initial BOM accepted; LF/CRLF framing; lone CR retained; final unterminated line valid; blanks skipped/counted. Invalid bytes use U+FFFD with damage/diagnostics; UTF-16/32 fail. Gzip magic detection includes stdin/concatenated members. .gz without magic, CRC/truncation/trailing nongzip bytes fail. Provenance/hash covers original decompressed bytes including separators; positions are inclusive lines and half-open bytes.

Auto recognizes one-line JSON object candidates, timestamp text, level text, then plain text per record. Malformed JSON remains damaged text. Arrays/primitives are plain text in auto; explicit JSONL requires objects and disables folding. Explicit text never tries JSON; pretty JSON is unsupported. Text folds indented and recognized Node/Python/Java exception continuations. Blank/new header/JSON/source boundaries end folding; stack text never implies severity/cause.

JSON aliases (first non-null wins; wrong type blocks fallback; conflicts diagnosed): timestamp/time/ts,level/severity,message/msg,service/serviceName,logger/loggerName,requestId/request_id,traceId/trace_id,spanId/span_id. Remaining own keys are bounded sanitized attributes; prototype keys removed at every depth. Missing message is damaged; absent time/level/IDs stay null/unknown. Duplicate property names use JSON's last value.

Time strings require valid calendar date/time through seconds and optional1–3 fractional digits, explicit Z/±HH:mm or supplied assumption; max offset±14:00, -00:00 invalid. Integer JSON times are epoch milliseconds. Invalid dates/leap seconds/unsupported precision fail; no host timezone/unit guessing. UTC output uses milliseconds and years0001–9999. Severity aliases are TRACE,DEBUG,INFO/INFORMATION,WARN/WARNING,ERROR/ERR,FATAL/CRITICAL/CRIT after trim/ASCII case fold. Unknown structured/bracket tokens produce an informational diagnostic; arbitrary leading text words stay message text.

## Analysis

Input counters precede filters; summaries/groups use selection. Search matches normalized messages before protection, once/event. Context counts event positions, obeys filters/source boundaries and avoids duplicates. Only the first limit matches anchor windows; later matches still count but are omitted even inside context. Text/NDJSON stream with backpressure; JSON search buffers capped projected results.

Fingerprint mode includes eligible error/fatal events only. Its versioned tuple contains exact nullable service/logger,severity,first message line (trailing horizontal space removed),explicit exception,first3 recognized frames,and digest of remaining continuations. Only numeric recognized frame locations normalize; digits/UUIDs/paths/other evidence stay distinct. Hash collisions compare full tuples and get separate keys plus partial diagnostic. First event is representative; rank by count then exact tuple/code-point order.

Exact ID groups include all selected levels, with case-sensitive request/trace/span namespaces separate. Missing IDs are uncorrelated. Public keys use encounter ordinals so protected equal-looking IDs stay distinct. Severity/source modes include all selected events; source keys use IDs. Reports include all3 identifier namespaces and nonempty UTC time buckets; untimed events are explicit. Shared identifiers indicate correlation, never verified cause.

New keys are admitted in encounter order until count/byte saturation, without eviction. Admitted counts remain exact; unadmitted events/memberships increment overflow and make coverage partial. Rankings then apply among admitted groups. Display limits/clipping alone do not make coverage partial.

## Machine output and statuses

[JSON Schema](../schemas/loglens.output.v1.schema.json) defines envelope fields/types. JSON is one envelope plus LF, with recursively code-point-sorted keys and deterministic array order. No wall clock,absolute input path,random identifier or host metadata appears. Always-present fields:schemaVersion,command,coverage,redaction,issues,stats,sources,summary,events,groups,correlations,timeline,analysis. Unused arrays are empty; missing evidence is null.

eventsRead/damage/bytes/physical-line/diagnostics cover consumed input; severity/timed/untimed totals cover selected events. Sources distinguish complete/partial/failed; failed means no evidence consumed. Search-only match/emitted/context counters are null otherwise. Fingerprint counts+overflow+ungroupable conserve selected error/fatal counts; timeline+overflow conserve selected timed events; each event may have3 ID memberships.

NDJSON search emits start,event records,summary(envelope with events=[]); every record has schemaVersion/type. Check status and summary presence. Machine stderr uses separate diagnostic NDJSON with safe code/sourceId/message, never offending raw values/stacks. Human diagnostics are stderr-only. Validation failures may have no envelope.

Statuses:0 complete;1 complete search/no match;2 usage;3 usable partial;4 I/O/security/output/invariant;130 SIGINT;143 SIGTERM where supported;141 quiet closed stdout. Precedence:signal/EPIPE,fatal output/invariant,usage,partial,no match,success. All unreadable inputs fail4; a valid empty source is usable. Only0/1/3 may commit output files. Interrupted stdout can be incomplete and has no normal completion guarantee.

## Protection and fixed limits

Default policy1 redacts known sensitive structured keys,assignments/headers,bearer/provider/JWT,URI userinfo and private-key blocks. Protect before retention/rendering,after selection; raw hashes are null unless pattern protection is disabled. Controls/bidi/HTML/Markdown escaping remains under paired sensitive flags. Static HTML has no scripts/external assets. Arbitrary PII/health/custom/encoded/fragmented secrets and short tokens can remain; fingerprints reveal equality/guessing risk. Reports state these limitations.

Limits:1024 sources;64 KiB chunks plus runtime buffering;1 MiB physical line;4 MiB multiline;64 KiB overflow prefix;16 KiB message/severity token;256-byte service/logger;512-byte IDs;64 KiB metadata/depth32/10000 nodes;64 retained diagnostics plus exact observed-code counts;64 KiB export/8 KiB representative serialized;context100 each/8 MiB;10000 keys/map and64 MiB combined accounted state;decoded10 GiB/source,50 GiB/run;encoded gzip independently10/50 GiB;ratio200:1 after1 MiB;aggregate output/JSON search retention32 MiB. Loss is diagnosed; output overflow fails4 before file commit. Node/GC/zlib RSS is additional to accounted state. Dedicated performance gates remain unverified.

New-file output requires owned native authority, sync and no-replace publication. Windows retains checked local-drive ancestor and file handles, prevents temp replacement/writes and publishes/discards by owned handle. Unverified UNC/device/extended namespaces fail closed. Linux uses an unnamed mode0600 inode and descriptor-source publication where supported; it is not runtime-verified here. macOS safe output is incomplete and rejects UNSAFE_OUTPUT. Windows ACLs still determine effective privacy. These platform gaps block release; no mandatory matrix requirement is waived. Missing/incompatible backends report NOT_AVAILABLE/exit2 without unsafe fallback. Crash residue requires manual review; appends beyond opened size are ignored; same-size overwrite detection is unavailable. See [README](../README.md) and [release notes](RELEASE_NOTES.md).
