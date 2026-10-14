# Canonical data contract

Owner of internal event semantics. Schema version: `loglens.event.v1`. Public output projections are specified in [CLI_CONTRACT](CLI_CONTRACT.md). Types below are specification notation, not source implementation.

## Event fields

Objects MUST contain all fields below. Absent scalar values are `null`, not omitted, empty, inferred, or `undefined`. Arrays may be empty. Counters/offsets MUST be nonnegative safe integers; overflow aborts with an internal invariant failure before an inaccurate value is emitted.

| Field | Type and invariant |
| --- | --- |
| `schemaVersion` | Literal `loglens.event.v1` |
| `id` | `sNNNNNN:eN`; six-digit 1-based source index and unpadded 1-based event ordinal; max sources 1024 |
| `source` | `{ id, label, kind }`; ID `sNNNNNN`; kind `file` or `stdin`; label basename or `stdin`, collision-safe via ID |
| `position` | `{ lineStart, lineEnd, byteStart, byteEnd }`; 1-based inclusive physical lines, 0-based half-open decompressed byte interval including consumed line separators |
| `timestamp` | `{ epochMs, isoUtc, original, interpretation }` or `null`; safe integer milliseconds; UTC RFC3339 with exactly 3 fractional digits; interpretation `explicit-offset`, `epoch-ms`, or `assumed-offset` |
| `severity` | One of `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `unknown` |
| `severityOriginal` | Recognized input scalar converted to text, or `null`; unknown tokens retained |
| `message` | String; empty permitted; bounded retained prefix with explicit damage diagnostic on overflow |
| `service`, `logger` | Case-sensitive strings or `null`; never derived from filenames |
| `correlation` | Object with `requestId`, `traceId`, `spanId`; string or `null` for each; no generated IDs |
| `attributes` | JSON object of non-promoted structured keys; sanitized against prototype keys; `{}` for text/no metadata |
| `raw` | `{ text, complete, byteLength, sha256 }`; decoded text without final record separator, complete tells whether retention covers the consumed record; byteLength and hash cover all consumed decompressed record bytes including separators; SHA-256 is 64 lowercase hex characters internally |
| `format` | `jsonl` or `text`; fallback from malformed JSON is text with a diagnostic |
| `diagnostics` | Ordered array of `{ code, line, field }`; physical line number, optional field represented by `null`; max retained tuples per performance limits; never includes untrusted error text |

Event IDs are run-local provenance, not content hashes. Repeated entries remain separate events. Identical file arguments are deduplicated by resolved path as defined in the CLI; identical content in distinct sources remains distinct. No inferred causal links are fields in this schema.

## Time and severity

Accepted string timestamps MUST be complete calendar dates with time: `YYYY-MM-DD[T or space]HH:mm:ss`, optional 1–3 fractional digits, and `Z` or `±HH:mm`. Zone-less equivalents require `--assume-timezone`; absent that flag, timestamp is null with `AMBIGUOUS_TIME`. Date-only values, leap seconds, impossible dates, unsupported precision, locale dates, timezone abbreviations, and IANA names are invalid. Offsets have hours 00–14, minutes 00–59, and at hour 14 minutes MUST be 00; `-00:00` is ambiguous and invalid. Dates and normalized UTC results MUST remain within years 0001–9999. Calendar validation MUST reject normalization of February 30 into March.

JSON integer timestamps are epoch milliseconds only, including negative integers within the date range. No seconds/milliseconds magnitude heuristic. Fractional numbers are invalid. Missing time has no diagnostic; present invalid time gets `INVALID_TIME`. Original text is preserved; normalization changes representation, not precision. UTC is the only machine-output timezone. `--assume-timezone` accepts UTC or a fixed offset; it never reads the host timezone.

Severity tokens are trimmed and ASCII case-insensitive: TRACE→trace, DEBUG→debug, INFO/INFORMATION→info, WARN/WARNING→warn, ERROR/ERR→error, FATAL/CRITICAL/CRIT→fatal. All other tokens, including numeric values, map to unknown; a present unmapped token gets `UNKNOWN_SEVERITY`. Missing severity maps to unknown without a diagnostic. Exceptions/stack traces do not imply error severity.

## Structured extraction and incomplete evidence

[PARSING_SPEC](PARSING_SPEC.md) owns aliases and precedence. Promoted fields MUST be removed from attributes, including unused conflicting aliases, which remain recoverable in raw. Nested JSON values are limited to JSON types; no date objects, buffers, NaN, infinities, functions, prototypes, or bigint values. Keys `__proto__`, `constructor`, and `prototype` MUST be removed at every depth with `UNSAFE_KEY` diagnostic, using own-property access.

Type mismatch leaves a promoted field null/unknown, emits `INVALID_FIELD`, and preserves the raw source. Null aliases count as absent. Empty service/logger/identifier strings count as absent; whitespace-only values count as absent, otherwise preserve exact strings. Message strings are not trimmed. No fallback may fabricate an apparently original message from unrelated metadata. JSON numbers use finite IEEE-754 doubles; unsafe integers or nonfinite parsed numbers in attributes cause attributes to become `{}` with `INVALID_NUMBER`. Such numbers in promoted fields are invalid, leave the field null/unknown (including severityOriginal=null), and add `INVALID_NUMBER` plus the relevant field/time diagnostic. Raw retains the original numeric spelling; decimals are not promised arbitrary-precision arithmetic. Unpaired JSON Unicode surrogates become U+FFFD with `INVALID_UNICODE`; raw decoded text retains its original JSON escape spelling.

Malformed JSON, invalid UTF-8, truncated input, oversized fields/events, and discarded metadata MUST be visible through diagnostics and completeness counters. An incomplete retained prefix MUST NOT be presented as a complete original. `raw.complete` concerns raw retention only; a message can be truncated even if raw is complete. Every loss of analysis evidence is counted independently of raw retention. Limits belong to [PERFORMANCE_SPEC](PERFORMANCE_SPEC.md).

## Determinism and compatibility

Source order and event ordinals define canonical processing order. Diagnostics sort by physical line, then code, then field using Unicode code-point order; duplicate identical diagnostic tuples on one event are collapsed. Object keys serialize recursively in Unicode code-point order, arrays retain order, output uses UTF-8/LF, and non-ASCII characters remain literal except required JSON escaping. No generation time, wall-clock duration, absolute source path, random ID, or platform metadata belongs in deterministic output.

Public exports use this event shape after security projection and add `redaction` and `match` fields as defined in the CLI. Internal raw data never bypasses that projection. Additive fields require documented minor-version evolution; removal, meaning changes, type changes, or enum expansion require a new schema major. Consumers SHOULD reject an unsupported schema major and tolerate unknown fields within a known major. [RELEASE_SPEC](RELEASE_SPEC.md) ties this to package versioning.
