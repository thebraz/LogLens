# Parsing specification

Owner of recognition, framing, extraction, and recovery. Canonical fields and timestamp grammar belong to [DATA_CONTRACT](DATA_CONTRACT.md); numeric caps belong to [PERFORMANCE_SPEC](PERFORMANCE_SPEC.md). Stage 1 implemented the one-line subset; Stage 2 implements the documented multiline grammar and gzip input. See [Stage 2 acceptance](STAGE_2_ACCEPTANCE.md). Actual checks are in [Stage 1 acceptance](STAGE_1_ACCEPTANCE.md).

## Bytes, lines, and records

Inputs MUST be treated as UTF-8. A UTF-8 BOM is allowed only at decompressed byte zero and excluded from message/raw text while remaining in byte offsets and hashes. Invalid byte sequences become U+FFFD, emit `INVALID_UTF8`, and make evidence incomplete; the raw hash still covers original bytes. UTF-16/UTF-32 BOMs cause `UNSUPPORTED_ENCODING` source failure. NUL is retained internally and escaped externally; input never executes.

LF and CRLF delimit physical lines; a lone CR is content. A final unterminated line is a valid line, not inherently a truncation. Empty/ASCII-whitespace-only lines outside a multiline event are skipped and counted as `blankLines`; within a pending event they terminate it and are skipped. Zero-byte input produces zero events. Final raw text excludes its final LF/CRLF but preserves internal separators exactly. Byte ranges/hash include consumed separators; blank terminators are excluded from the preceding event's range.

Source ordinals reset per source. Multi-line records MUST NOT cross source boundaries. Gzip positions refer to decompressed bytes; compressed offsets are not event provenance. Hashes are SHA-256 over original decompressed record bytes, not re-encoded text.

## Format selection and precedence

`--format auto` is the default. Detection occurs at each nonblank physical line:

1. After optional ASCII spaces/tabs, a leading `{` attempts a complete single-line JSON object.
2. Otherwise attempt the timestamp-prefixed text grammar.
3. Otherwise attempt level-prefixed text.
4. Otherwise preserve the whole line as an unstructured text message.

A malformed JSON candidate becomes a text event with `MALFORMED_JSON`; it MUST NOT silently become a clean text event. JSON arrays/primitives in auto mode are plain text. In explicit `jsonl`, every nonblank line MUST be an object; malformed JSON or other top-level values become text fallback events with `MALFORMED_JSON` or `NON_OBJECT_JSON`. Explicit `text` never attempts JSON. Pretty-printed multi-line JSON is unsupported and treated line by line with diagnostics where applicable. No file extension determines record format.

Explicit format selects interpretation and never silently changes to a different clean parser. Mixed JSON/text sources are supported in auto mode. Explicit JSONL disables continuation folding; auto mode permits text continuations but never attaches a continuation to a JSON event.

## JSON extraction

Use the first non-null present alias in the following order. Presence with a wrong type blocks fallback and emits `INVALID_FIELD`. Distinct non-null values in multiple aliases emit `CONFLICTING_FIELDS`; selection remains first alias. Raw retains the evidence. Duplicate identical JSON property names use the JSON parser's last value; raw preserves both spellings. No claim of duplicate-key detection is required in V1.

| Canonical field | Top-level aliases, in precedence order | Accepted types |
| --- | --- | --- |
| timestamp | `timestamp`, `time`, `ts` | String in timestamp grammar or integer epoch milliseconds |
| severity | `level`, `severity` | String or number; unmapped numbers are unknown |
| message | `message`, `msg` | String; missing yields empty string with `MISSING_MESSAGE` |
| service | `service`, `serviceName` | String |
| logger | `logger`, `loggerName` | String |
| requestId | `requestId`, `request_id` | String |
| traceId | `traceId`, `trace_id` | String |
| spanId | `spanId`, `span_id` | String |

Unpromoted own keys remain in attributes subject to sanitization/limits. A string `stack` attribute is retained as metadata and available for fingerprint frame extraction; it does not replace message or increase physical line range. Nested aliases are not auto-discovered. Missing severity/time/identifiers are valid absences. Message type mismatch yields empty message and `INVALID_FIELD`, not implicit JSON serialization of the object.

## Text grammar

Recognized header forms are `[timestamp] [LEVEL] message`, `timestamp LEVEL message`, `[LEVEL] message`, and `LEVEL message`, where square brackets are literal optional wrappers around each token. Timestamp has the grammar in the data contract; a space between its date/time is part of that token. Separators are one or more ASCII spaces/tabs, optionally a single ` - ` between header and message. A timestamp alone or followed directly by free text yields a timestamped event with unknown severity. A recognized level alone yields an empty message.

Header-level recognition uses the documented severity aliases only. Arbitrary leading words are message text, not unknown levels. A bracketed token in level position is an explicit level token: an unrecognized token maps to unknown and is removed from the message with `UNKNOWN_SEVERITY`. Timestamp-shaped prefixes beginning with `YYYY-MM-DD` plus `T`/space and time digits are parsed as time candidates; invalid candidates are preserved in raw, removed from the header/message only when their token boundary is clear, and get `INVALID_TIME` or `AMBIGUOUS_TIME`. Otherwise the whole line is text. Service/logger/IDs MUST NOT be guessed from free text.

Single-line parsing preserves message content after removing header/separators; it does not trim trailing message whitespace. Recognized input examples:

| Input | Required result |
| --- | --- |
| `2026-10-13T09:00:00-03:00 ERROR payment failed` | UTC 12:00, error, message `payment failed` |
| `[WARN] cache miss` | Untimed warn event |
| `hello world` | Untimed unknown event, no parse error |
| `2026-10-13 12:00:00 INFO ready` | Ambiguous/null time unless fixed assumed timezone is supplied |
| `{"level":"error","msg":"failed"}` | JSON event with error, missing time allowed |
| `{"level":` | Text fallback, malformed diagnostic, partial analysis |

## Multiline framing (Stage 2)

Hold at most one pending text event. A line with a recognized timestamp/level header starts a new event, even if indented. A JSON candidate starts a new event in auto mode. Otherwise a nonblank line attaches only if a text event is pending and it matches one of:

- Begins with ASCII space/tab (indented continuation).
- Begins exactly `Caused by:`, `Suppressed:`, `Traceback (most recent call last):`, or `During handling of the above exception`.
- Begins `at ` or `... ` followed by digits and ` more`.
- Matches an unindented qualified exception/error name ending in `Exception` or `Error`, optionally followed by colon and text, while the pending event already contains a traceback/exception marker.

The resulting message concatenates the first message and continuation lines with LF; raw preserves physical separators. A blank line flushes the pending event. A noncontinuation flushes the previous event and begins its own. An orphan continuation becomes its own unknown text event with `ORPHAN_CONTINUATION`; later indented lines may attach to it. No severity or causal link is inferred from stack syntax. Generic unindented lines are separate events; V1 does not claim universal multiline recognition.

Stage 1 emits each nonblank physical line separately and does not claim multiline support. Stage 2 replaces that behavior according to [STAGE_PLAN](STAGE_PLAN.md).

## Limits and recovery

- An over-limit physical line MUST be drained to its delimiter while hashing/counting all consumed bytes. Flush any previous pending event first; emit one standalone damaged text event with only the bounded prefix, `LINE_TOO_LARGE`, `raw.complete=false`, and accurate full position/byteLength. Do not feed an over-limit line to JSON parsing or attach it to a preceding multiline record.
- A pending multiline event exceeding the event limit keeps its bounded prefix, drains recognized continuation lines, and emits one event with `EVENT_TOO_LARGE`; a new header resumes parsing normally. Never split overflow into apparently independent clean events.
- Field limits produce `FIELD_TOO_LARGE`, a retained string prefix, and incomplete evidence. Oversized/deep/over-node metadata becomes `{}` with `METADATA_LIMIT`; raw may still be complete. Limits are checked before expensive normalization where possible; depth/node traversal is iterative and bounded.
- A read failure or detected shrink of an opened regular file emits `SOURCE_TRUNCATED` on a pending event if present and marks that source incomplete. Final missing LF alone is not a failure. Files use initial opened size as the read boundary; appends are ignored. Same-size concurrent overwrites cannot reliably be detected and are an explicit limitation.
- A corrupt/truncated gzip emits `GZIP_INVALID`; already parsed events remain evidence but the source is incomplete. CRC/end-marker failure is never reported as successful decompression.
- UTF-8, field, parsing, or retention defects continue at the next safe record boundary. Source byte/ratio limits stop that source. Output failure, internal invariant failure, or cancellation stops the run.

Every incomplete event contributes once to `damagedEvents`, regardless of diagnostic count. Unknown severity alone and deliberately assumed timezone are informational; malformed JSON, invalid/ambiguous time, conflicting/invalid fields, missing message, unsafe keys, orphan continuations, invalid encoding/Unicode/numbers, truncation, and limit losses are damage. Retained diagnostic tuples are bounded; the fixed observed-code set preserves exact diagnosticCounts even if tuples are omitted. The exact counters/status consequences are in [CLI_CONTRACT](CLI_CONTRACT.md). No discarded content is silently claimed as parsed evidence.
