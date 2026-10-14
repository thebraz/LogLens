# Security model

Current implementation update for 0.1.0-beta.1: D19 and
[Stage 4 acceptance](STAGE_4_ACCEPTANCE.md) supersede the historical Stage 3
pathname implementation notes below. No supported-platform gate is waived.

Owner of trust boundaries, output protection, and local file policy. This is a design threat model, not a completed security audit. Log content, filenames, structured keys, compressed bytes, and CLI values are untrusted. LogLens MUST perform no telemetry, external input-data transmission, remote fetches, or input-triggered executable loading.

## Assets and threat boundaries

Protect credentials/PII in input, the user's filesystem, terminal integrity, report viewers, and CPU/memory availability. An attacker may supply arbitrary log bytes, paths through user arguments, malformed gzip/JSON, or an output path in an attacker-writable directory. LogLens cannot protect against a fully compromised user account, malicious runtime/OS, concurrent hostile filesystem administrator, or secrets already passed visibly in shell arguments.

| Threat | Required control and acceptance |
| --- | --- |
| Terminal escape injection | Escape ESC, C0/C1 controls except output-controlled LF/tab, DEL, Unicode bidi controls U+202A–U+202E/U+2066–U+2069, and line separators U+2028/U+2029 as visible `\\uXXXX`; untrusted field newlines/tabs are escaped in one-line cells |
| HTML/Markdown injection | HTML-escape &, <, >, quotes; no script, external CSS/fonts/images, links from input, raw HTML, event handlers, or executable URIs; Markdown escapes syntax and uses safe fences longer than any content backtick run |
| Structured-output injection | Use JSON serializer, never concatenate raw strings into JSON; controls escaped; object key handling uses own properties |
| Credential/token exposure | Mandatory default protection policy below; no raw records in errors/debug stacks |
| Path traversal / overwrite | Explicit paths only, no input-derived output paths; new-file-only output and safe atomic commit |
| Symlinks / special files | Reject input/output leaf symlinks and nonregular inputs; resolve/check existing ancestors and reject symlink/reparse-point ancestors for data paths |
| Resource exhaustion / gzip bomb | Enforce [PERFORMANCE_SPEC](PERFORMANCE_SPEC.md) byte/state/ratio caps and cancellation before further parsing/allocation |
| Dangerous regex | Literal search only; built-in scanners MUST avoid nested/backtracking-unbounded expressions and use bounded linear scans |
| Deep JSON / prototype pollution | Per-line cap before JSON.parse; iterative depth/node checks; reject dangerous own keys at every depth; never merge input into configuration/prototypes |
| Dependencies / temp leaks | Standard-library-first review, no lifecycle downloads, restricted local temp output, cleanup on failure |

## Default redaction policy version 1

Output protection is enabled by default in every format and diagnostic. Parse/filter/group on original validated data; protect before retaining representatives/context or rendering external strings. Statistics, UTC normalized timestamps, event/source IDs, line/byte positions, and severity remain visible. Service/logger/source labels remain visible except when they match protection patterns. Never output absolute source paths by default; use basename plus source ID. Raw hashes are null in protected exports to reduce content-guessing exposure. Fingerprint digests remain visible for grouping, revealing equality and potentially permitting guesses for low-entropy templates; this residual exposure MUST be documented in user-facing security guidance.

Required deterministic detection:

- Recursively normalize a structured key to lowercase ASCII and remove `_`, `-`, and spaces. Values under keys equal to `password`, `passwd`, `pwd`, `secret`, `clientsecret`, `token`, `accesstoken`, `refreshtoken`, `idtoken`, `apikey`, `authorization`, `proxyauthorization`, `cookie`, `setcookie`, `privatekey`, `connectionstring`, or `dsn` become `[REDACTED]` in their entirety, regardless of JSON type.
- In every string (message, raw, attributes, labels, identifiers, logger/service, diagnostic parameter), redact case-insensitive key/value assignments using those key spellings followed by `:` or `=` and a quoted value or an unquoted value terminated by whitespace/comma/semicolon. Preserve the key and delimiter; replace the whole value. Quoted scanning respects escaped quotes. Ambiguous unmatched quotes redact to end of that string.
- Authorization/Proxy-Authorization/Cookie/Set-Cookie header-like lines redact the entire remainder of their line. Bearer credentials after `Bearer ` redact the next nonwhitespace token, minimum length 1.
- Redact JWT-like three base64url segments separated by dots when each segment has at least 8 characters; provider-shaped prefixes `sk-`, `ghp_`, `github_pat_`, and `AKIA` followed by at least 16 ASCII alphanumeric/underscore/hyphen characters. No provider validation or remote lookup.
- Redact userinfo in URI-like `scheme://user:password@host` strings, preserving scheme/host. Redact private-key blocks from `-----BEGIN ... PRIVATE KEY-----` through matching END marker, or to retained string end if unterminated. Field-size boundaries MUST NOT leave a retained credential prefix exposed: run scanning before display clipping, and redact unterminated recognizable sensitive patterns through the retained end.

Matchers MUST operate in documented order: structured sensitive key, private-key block/header, URL userinfo, assignment, bearer/provider/JWT token. Overlapping matches form the union of protected spans and replacement is `[REDACTED]`; recursive scanning MUST NOT repeatedly transform the marker. No unbounded regex. A structured sensitive value stays a string marker even if its original type was an object. Preserve non-sensitive JSON structure and exact counts.

Detection cannot reliably find arbitrary custom tokens, passwords without labels, personal names, emails, health information, encoded/encrypted secrets, fragmented secrets across unrelated records, or secrets in binary content. No blanket PII or perfect-redaction claim. Short provider-token prefixes that fail the defined length test can remain visible; synthetic tests MUST include both matches and documented misses. Reports MUST state this limitation and whether protection was disabled.

`--no-redact --ack-sensitive-output` is the only V1 authorization to disable pattern protection. Both flags are required together on each invocation; no prompt, saved preference, environment variable, or TTY heuristic substitutes. Safe terminal/HTML/JSON escaping, path restrictions, and limits always apply. `--include-raw` controls inclusion separately and does not disable protection. Even explicitly sensitive output is a bounded decoded projection, not byte-perfect original extraction.

## Output projection and safe errors

Protect strings first, then render-format escape. For 64 KiB event projection or 8 KiB representative caps, deterministically remove attributes, remove raw text (set complete=false), then shorten message to the largest UTF-8 character-boundary prefix that fits serialized cap, retaining a visible `[TRUNCATED]` suffix. If necessary also shorten original timestamp/severity strings and labels/service/logger/IDs in that order. Never shorten event IDs, numeric positions, normalized timestamp, or counts. Set displayTruncated=true. A source label is capped to 256 UTF-8 bytes for export. Group `key` values derived from explicit IDs use encounter-ordinal keys rather than exposing a sensitive ID; a separate displayed value follows the same protection. [CLI_CONTRACT](CLI_CONTRACT.md) specifies schemas.

Serialization caps include escaping and metadata, checked after projection; bounded field limits guarantee a minimal event fits. Export changes MUST NOT feed back into filters, counts, grouping, or provenance. Raw `sha256` is null while protection is enabled, real digest only under paired sensitive-output flags. Internal raw hash is never null.

Errors use static safe descriptions and source IDs/escaped protected labels, not raw exception messages, offending lines, query/ID values, or complete paths. No default debug dump, stack, argv echo, or secret-containing temporary diagnostics. JSON diagnostic codes are stable; exact human prose MAY improve within a minor release without changing meaning.

## Filesystem and temporary output

Explicit absolute/relative input paths are allowed, including `..` components that resolve to a user-selected regular file; traversal from log content is never allowed. Bind each component traversal to the retained parent handle/descriptor and validate the opened object; pathname checks alone are insufficient. Reject symlinks, Windows junctions/reparse points, directories, and device-like targets. O_NOFOLLOW MUST be used where supported, with equivalent native reparse rejection on Windows. If the platform cannot reliably identify a reparse point, fail that path with `UNSAFE_PATH`, not silently follow it. Missing/incompatible backends fail NOT_AVAILABLE without pathname fallback. Race resistance MUST be tested on actual supported OSes; a pre-open check alone is not an atomic guarantee.

Output parent MUST already exist and pass component checks. Output MUST NOT alias any input; it MUST NOT preexist. Create a randomized exclusive temp file in the destination directory, mode 0600 on POSIX; directory access/ACLs on Windows determine effective privacy. Write with backpressure, flush/close, and atomically commit using a no-replace operation (for example exclusive hard-link creation followed by unlinking temp); rename APIs that overwrite a raced destination are prohibited. Filesystems lacking a safe no-replace mechanism fail `UNSAFE_OUTPUT`. Temp paths are not input-content-derived; no temp file is used for input data or event-history spooling. The temporary destination holds only the chosen rendered output, which can contain sensitive content if explicitly authorized by paired flags.

Exit 0/1/3 may commit a complete output document with truthful coverage. Other statuses delete the uncommitted temp file. Crash/power-loss cleanup is not guaranteed; document restrictive temp files may remain and require manual removal. Never delete unknown preexisting files during cleanup. stdout has no storage/permission guarantee; users choose its destination.

The implementation MUST pass the security cases in [TESTING_STRATEGY](TESTING_STRATEGY.md) before release. An independent adversarial review occurs in Stage 3, without treating this design as proof of security.

Stage 2 additionally protects a recognized provider prefix at the end of a parser-truncated field/raw prefix, even if clipping cut it before the ordinary minimum credential length. Complete short tokens remain documented detector misses. This only strengthens output protection at a known retention boundary; filtering/fingerprints still use the validated original retained field.

Stage 3 hardening (D18): raw JSON protection scans decoded quoted keys and string values without building another recursive metadata tree. Sensitive arrays/objects are removed as entire values, including duplicate/escaped keys; generic assignments likewise protect balanced containers or their unterminated retained remainder. Separated sensitive-key spellings are not limited to 40 input characters. JWT matching uses base64url segment boundaries, including leading/trailing hyphens; URL/JWT recognition uses maximal-token scans instead of overlapping unbounded regexes. Recognizable partial JWT/userinfo/provider suffixes at a known parser retention boundary are protected conservatively. Pattern limitations above still apply.

The input operation cancels its own pending upstream read on gzip rejection/consumer closure before awaiting decompressor cleanup. Independent compressed-byte caps also bound gzip headers that never produce decoded output.

Historical Stage 3 implementation note, superseded by D19: temporary commit/discard
compared identities around Node pathname operations, which did not provide atomic
confinement. The original deterministic ancestor-swap failure remains recorded in
[AUDIT_REPORT](AUDIT_REPORT.md). Current Windows production I/O instead retains
checked native ancestor/file handles, rejects reparse points and uses handle-relative
no-replace rename and owned-handle cleanup. Current exercised Windows schedules are
in [Windows acceptance](WINDOWS_BETA_ACCEPTANCE.md). Finite regression evidence does
not establish exhaustive safety or resolve Linux/macOS requirements. The original
multiplatform Stage 4 remains PARTIAL.
