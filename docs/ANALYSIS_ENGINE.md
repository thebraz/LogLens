# Analysis engine

Algorithms describe full-V1 requirements. Stage 1 implements inspection counts, severity and timestamp coverage only; selection/search/grouping/correlation/timeline are implemented; Stage 2 local evidence and reference limitations are in [acceptance](STAGE_2_ACCEPTANCE.md). Inputs are canonical events; common selection semantics belong to [CLI_CONTRACT](CLI_CONTRACT.md). Retained-state limits belong to [PERFORMANCE_SPEC](PERFORMANCE_SPEC.md). Actual checks: [Stage 1 acceptance](STAGE_1_ACCEPTANCE.md).

## Counts, time, and search

Count every event, including duplicates and damaged events, once in input totals. Selected severity counts include unknown. Summary timestamp min/max use valid timestamps only, regardless of arrival order. Missing/invalid times are untimed, never epoch zero. Percentages in human output use count/selectedEvents ×100 rounded half-up to two decimals; denominator zero prints `n/a`. Machine output contains exact counts, not rounded percentages.

`--since` is inclusive and `--until` exclusive. Time comparisons use epochMs, never lexical original strings. Null timestamps fail an active time filter and increment timeExcludedMissing once before other filters, even if another predicate would also reject that event. Other filter families are as specified in the CLI.

Search matches literal substrings of normalized message, including LF within multiline messages. It does not search raw, attributes, service, or filenames. ASCII case folding affects only A–Z. A query can contain LF passed as one argument; no regex syntax or escaping language is interpreted. An event contributes at most one match regardless of occurrence count. Matching occurs before redaction, so a match may appear as a redacted value; output MUST say selection used original content without revealing it.

Context positions count canonical events within the same source, not lines or timestamps. Keep up to --before previous projected events; emit eligible previous events once when a match is found, then eligible next --after events. Ineligible events consume positions but are never rendered. Overlapping windows produce one event per ID. If a previously emitted context event later matches, it MUST be marked as a match originally: compute its own predicate before retaining/emitting it. Matching events carry `match=match`, other context carries `match=context`.

Only the first --limit matching events anchor output windows, in source order; all matches still increment matchedEvents. Matching events beyond that limit MUST be omitted, including when they occur inside an anchored context window; they still consume a context position. Context after the final anchor includes only nonmatching eligible events. emittedMatches counts rendered anchors; contextEvents counts rendered nonmatches. Output records remain in source/event order. A match not rendered because of limit sets displayTruncated. Context cannot cross a failed or completed source boundary.

## Conservative fingerprint grouping

Fingerprint mode includes selected `error` and `fatal` events only. Unknown severity and exceptions without an explicit error/fatal level are not inferred errors. Group only events with no damage affecting message, service/logger, severity, or stack evidence. Time-only damage, including timestamp alias conflicts, does not make an otherwise intact message ungroupable. Damaged message/metadata with unknown stack completeness, malformed JSON, oversized line/event, invalid UTF-8/Unicode, unsafe keys, conflicts in grouping fields, or truncated source record make that event ungroupable. Count excluded error/fatal events in ungroupableEvents.

The version-1 grouping tuple is ordered:

1. Literal algorithm tag `loglens.fingerprint.v1`.
2. Exact nullable service and logger (null differs from empty string, though normalization removes empty fields).
3. Canonical severity; fatal and error remain separate.
4. Message first line with trailing ASCII spaces/tabs removed; all digits, URLs, UUIDs, case, paths, punctuation, and interior whitespace preserved.
5. First explicit exception-type token, if any, matching qualified identifier ending in `Error` or `Exception` before a colon; otherwise null.
6. First three recognized stack frames, in encounter order, from message continuations then string `attributes.stack`; suppress exact duplicate frames. Each frame retains language form, function, and full path/module. Only terminal numeric line/column locations are replaced by `<line>`/`<column>`.

Recognized stack frames are JavaScript `at function (path:line:column)` / `at path:line:column`, Python `File "path", line N, in function`, and Java `at qualified.method(File.java:N)`. Other continuation text is appended as an exact additional tuple string with trailing horizontal whitespace removed; do not throw it away. All continuation lines not represented by the three retained frames, including later frames, MUST be represented by an exact normalized continuation digest so differences are not silently merged. Numeric-location removal applies to recognized frames throughout that digest; other content is exact. Missing stack is a distinct tuple component from a stack. Missing service/logger may reduce diagnostic specificity and MUST be shown, not guessed.

Serialize the tuple as canonical JSON and hash SHA-256 UTF-8. Store/compare the full canonical tuple when digests match; a different tuple with the same digest MUST remain separate with a deterministic `:<collisionIndex>` suffix starting at 2 and `HASH_COLLISION` partial diagnostic. Fingerprint key is normally 64 lowercase hex characters, optionally that collision suffix. Hash equality alone MUST NOT establish grouping.

No variable-token masking in V1. `failed account 123` and `failed account 456` remain separate. Equal messages in different services/loggers or with different exception/stack evidence remain separate. This intentionally under-groups some related failures to avoid unsupported equivalence. Normalized source locations are the only stack abstraction; no fuzzy matching, embedding, or similarity threshold.

## Frequency, representatives, and explicit correlation

Groups count admitted members exactly. Representative = first canonical event in input order, retained as a bounded protected projection. FirstSeen/lastSeen use valid timestamp min/max; null if none. Rank groups by count descending, then internal canonical tuple in Unicode code-point order, then representative source/event order. --top affects rendering only. Ties MUST NOT depend on hash-map iteration order, locale, or redacted display strings.

Explicit-ID modes group all selected events with the chosen non-null ID, not only errors. Namespace key is `(kind, exact value)`; no case folding, substring matching, numeric coercion, time-gap join, or cross-namespace equality. Missing chosen ID increments uncorrelatedEvents. Report includes all three kinds separately; an event with three IDs contributes three memberships, so correlation totals need not equal event totals. Span IDs without trace IDs remain namespaced span evidence, not a reconstructed trace tree.

Correlation group keys in public output are `request:gN`, `trace:gN`, or `span:gN`, where N is the admitted bucket's 1-based encounter ordinal within that namespace. The displayed value may be redacted; keys keep distinct protected rows distinguishable. Sorting is count descending, kind order request/trace/span, exact internal value code-point order, then representative position. No missing-ID super-bucket. Correlation demonstrates shared identifiers only; report wording MUST NOT assert temporal causality, request success, service dependency, or root cause.

## Temporal aggregation and saturation

Report buckets use width 60000/3600000/86400000 milliseconds for 1m/1h/1d, anchored to Unix epoch UTC; start = floor(epochMs/width) × width, including negative times. Numeric end is start+width; public end is null if that boundary exceeds year 9999, without altering membership/counts. Sort admitted buckets by start ascending. Do not materialize empty gaps. Untimed selected events appear in untimedEvents, not invented buckets. Every bucket has exact seven-level counts. Out-of-order timestamps do not change bucket membership.

Admit new group/identifier/time keys in encounter order until count or combined-byte capacity is reached. Never evict an admitted key. Update existing keys only if their fixed-size counters/bounds can update without exceeding caps. Keys retain only bounded tuple/representative data; no member arrays. Error grouping tuples exceeding remaining admission capacity count as overflow, not a truncated key. overflowGroupEvents counts eligible members whose tuple was not admitted; overflowCorrelationMemberships counts unadmitted kind/value memberships; overflowTimelineEvents counts valid timed events with unadmitted buckets. General source/selection/severity counts continue exactly.

Any saturation sets coverage partial and a safe `AGGREGATION_LIMIT` diagnostic. Rankings are **among admitted groups**, not claimed global top-N. An unadmitted group may be more frequent than an admitted one; no statistical estimate is substituted. ungroupableEvents and uncorrelatedEvents are distinct from capacity overflow. Display-only truncation does not make counters approximate. Reports MUST show input damage, limits, overflow, time coverage, and retained-display limitations alongside findings.

Useful invariants: fingerprint member counts + overflowGroupEvents + ungroupableEvents = selected error/fatal count; timeline counts + overflowTimelineEvents = selected timedEvents; selectedEvents = timedEvents + untimedEvents. Correlation equivalents apply per namespace. Tests MUST use exact expected totals and conservative-separation counterexamples.

## Severity and source grouping — D16

The Stage 2 request explicitly adds `--by severity|source` to the earlier CLI design. Both modes include every selected event, including damaged events, without error/fatal-only eligibility. Severity keys are `severity:<canonical level>`; missing severity stays in the explicit `unknown` bucket. Source keys are `source:<source ID>`, preserving distinct sources with equal labels; values display the protected label. Representatives are the first selected event, time bounds use valid member times, and ranking is count descending then exact severity/source-ID tuple in code-point order. The same key/byte admission policy applies; `overflowGroupEvents` counts unadmitted selected members. No member list is retained. `ungroupableEvents`/`uncorrelatedEvents` remain zero in these modes. Report error grouping remains fingerprint-only.
