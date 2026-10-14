# LogLens

**0.1.0-beta.1 — Experimental Beta — Windows x64 (2026-10-14).**
This experimental beta requires **Windows 11 x64 and Node.js 24.x**. It is not
production-ready. **Linux and macOS are not validated or supported by this beta.**
Release publication requires all Windows gates and observed successful remote CI.
The original multiplatform Stage 4 remains PARTIAL; its requirements are unchanged.
The source-tree `docs/WINDOWS_BETA_ACCEPTANCE.md` records current evidence.

Developer build: `npm ci --ignore-scripts`, `npm run build:native`, `npm run check`.
Native compilation requires the platform toolchain and Node headers. Consumers use
prebuilt Node-API v8 binaries from the verified tarball; no compiler, download or
install hook is required. File I/O reports `NOT_AVAILABLE` when its backend is
missing or incompatible; stdin to stdout remains available. Do not distribute this
Windows-only candidate as a completed multiplatform release.

LogLens is a local CLI for inspecting application log exports. It counts events and parsing defects, searches messages, groups explicit errors conservatively, follows exact request/trace/span identifiers, and produces local reports.

It requires **Node.js24.x**, uses TypeScript and ESM, and has **zero runtime dependencies**. No server, database, cloud account, AI model or telemetry is required. The CLI makes no network requests and does not transmit log data.

The package identity is `@thebraz/loglens`, version `0.1.0-beta.1`; the executable is
`loglens`. **The npm package has not been published.** Distribution for this milestone
uses a verified GitHub release archive only. The intended repository is
[thebraz/LogLens](https://github.com/thebraz/LogLens); current publication status is
recorded in the acceptance report. Windows native traversal, publication and cleanup
have finite regression evidence, not exhaustive security certification.

## Install the Windows archive

Use Node.js 24.x and npm on Windows x64. When available, download the `.tgz` and
`SHA256SUMS.txt` from the GitHub pre-release assets. A local prepared archive is in
`artifacts/`. Verify its checksum before installation:

```powershell
Get-FileHash .\thebraz-loglens-0.1.0-beta.1.tgz -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Install those verified bytes (from the download directory):

```sh
npm install --global --offline --ignore-scripts --no-audit --no-fund ./thebraz-loglens-0.1.0-beta.1.tgz
loglens --help
loglens --version
```

No compiler or native installation download is needed. To uninstall, run
`npm uninstall --global @thebraz/loglens`. There is no supported registry install
command for this beta. Source verification uses an isolated local installation
and the actual npm shim, then checks clean uninstall.

## Quick start

Save this synthetic input as `app.jsonl`:

```jsonl
{"time":0,"level":"info","message":"ready","service":"api","requestId":"r1"}
{"time":1000,"level":"error","message":"failed","service":"api","requestId":"r1"}
{"time":2000,"level":"error","message":"failed","service":"api","requestId":"r1"}
```

It contains three events, two errors in one fingerprint group, and three members of request ID `r1`. Integer times are epoch **milliseconds**, without a unit heuristic.

For example, `loglens inspect app.jsonl` includes these exact summary lines:

```text
Events read: 3
Selected events: 3
```

The complete output also includes severity, time coverage and protection limitations.

```sh
loglens inspect app.jsonl --output-format=json
loglens search app.jsonl --query=failed --level=error,fatal --before=1 --after=1
loglens group app.jsonl --by=fingerprint --top=10
loglens group app.jsonl --by=request-id
loglens report app.jsonl --output-format=json --output=incident.json
loglens report app.jsonl --output-format=html --output=incident.html
```

Outputs must be new files in existing directories. Existing files and input aliases are rejected. Run examples with unused output names.

## Commands and formats

| Command | Purpose | Output formats |
| --- | --- | --- |
| `inspect` | Input quality, selected severity/time coverage, source outcomes | text (default), json |
| `search` | Literal message search, bounded context | text (default), json, ndjson |
| `group` | Fingerprints, severity, source or exact identifiers | text (default), json |
| `report` | Summary, error groups, identifier evidence, UTC timeline | markdown (default), json, html |

`loglens --help` lists every option. [User contract](docs/USER_CONTRACT.md) defines flags, semantics, limits and statuses. [JSON Schema](schemas/loglens.output.v1.schema.json) describes `loglens.output.v1`. There is no supported programmatic API.

## Inputs and parsing

Inputs are explicit regular files or `-` for stdin, used once. No inputs selects piped stdin; an interactive terminal requires explicit input. A filename beginning with `-` needs positional `--`, with options before it. No glob or directory discovery. Directories, symbolic links, junctions and other reparse points are rejected by the Windows native backend. UNC, device and extended namespaces fail closed.

```sh
loglens inspect app.jsonl copy.jsonl --output-format=json
loglens inspect archive.gz --output-format=json
```

PowerShell stdin:

```powershell
'{"level":"info","message":"ready"}' | loglens inspect - --output-format=json
```

Gzip is detected by magic bytes, including stdin/concatenated members. A `.gz` file without magic fails. Corrupt/truncated gzip and trailing nongzip bytes produce incomplete coverage. Sources follow argument order; equivalent absolute path spellings are deduplicated (case-insensitive on Windows). Distinct files with identical content remain separate. No global timestamp sorting.

The parser supports JSON Lines objects, timestamp/level-prefixed text and plain text, with documented Node/Python/Java exception continuations. `--format=auto|jsonl|text` selects interpretation; explicit JSONL disables continuation folding. Pretty JSON and arbitrary multiline dialects are unsupported. UTF-16/UTF-32 are rejected. Malformed records retain diagnostics/provenance. Missing times, levels and identifiers are never invented.

## Search, filters and grouping

```sh
loglens search app.jsonl --query=FAILED --ignore-case --level=error --service=api --id=request:r1 --source=app.jsonl --since=1970-01-01T00:00:01Z --until=1970-01-01T00:00:03Z --output-format=json
loglens search app.jsonl --query=failed --limit=1 --before=1 --after=1 --output-format=ndjson
loglens group app.jsonl --by=severity
loglens group app.jsonl copy.jsonl --by=source
loglens group app.jsonl --by=trace-id
loglens group app.jsonl --by=span-id
```

Filter families combine with AND; level/source/ID values within their family combine with OR. Time bounds require explicit offsets: since is inclusive, until exclusive. Null-time events are excluded/counted. `--assume-timezone=UTC|±HH:mm` applies only to zone-less input; host timezone is never inferred.

Search examines normalized messages, including continuations, rather than arbitrary metadata/raw text. It uses literal matching and optional ASCII A–Z folding. Counts continue after the display limit. Context respects filters/source boundaries. Selection uses original content before redaction, so a matching value can be hidden.

Fingerprints include eligible error/fatal events, preserving digits, UUIDs, paths, severity, service/logger and exception evidence. Only numeric recognized stack locations normalize. Differing templates stay separate. Severity/source/exact-ID modes include all selected levels. Identifier namespaces are separate and case-sensitive; matching request/trace values do not establish a relationship. Correlation does not prove cause.

## Reports, privacy and security

HTML is static, escaped and script-free, with no external assets. Markdown/machine output use the same protected projections. Reports show input damage, untimed events, aggregation overflow, omitted rows and detector limitations. NDJSON search streams start/event/summary records; check process status and final summary.

Default protection redacts defined credential patterns across outputs and escapes terminal controls. It can miss personal/health data, emails, custom/encoded/fragmented secrets and short tokens. Review before sharing. Fingerprints reveal equality and can permit guesses of low-entropy templates.

`--include-raw` works only for search JSON/NDJSON and exports a bounded decoded projection, not original bytes. Raw hashes are null under default protection. Only paired `--no-redact --ack-sensitive-output` disables patterns for that invocation; escaping and limits stay active. Sensitive output can persist in stdout/files/crash residue.

Windows filesystem operations retain checked ancestor and file handles, reject
reparse points, create exclusive temporary files, publish with an atomic no-replace
handle rename and discard only the owned file handle. These controls address the
exercised LL-006/LL-008 schedules. Windows privacy still depends on directory ACLs.
Crash/power loss can leave `.loglens-*.tmp` for manual review. Appends beyond opened
size are ignored; same-size concurrent overwrites are undetectable. Stalled remote
filesystems and a compromised OS/account are outside the local-filesystem guarantee.

## Resource and performance limits

Input streams with backpressure; aggregation retains bounded state. Total Node/GC/zlib memory is not described as constant.

| Resource | Fixed cap |
| --- | --- |
| Sources | 1024 |
| Physical line / multiline event | 1 MiB / 4 MiB |
| Message / metadata | 16 KiB / 64 KiB; metadata depth32,10000 nodes |
| Event export / representative | 64 KiB / 8 KiB serialized |
| Context | 0–100 before/after; 8 MiB retained |
| Group/identifier/time keys | 10000/map; 64 MiB combined accounted state |
| Decoded input | 10 GiB/source;50 GiB/run |
| Encoded gzip | Independent10 GiB/source;50 GiB/run |
| Gzip expansion | 200:1 after1 MiB decoded |
| Aggregate output / JSON search retention | 32 MiB each |

Saturation sets partial coverage. Rankings cover admitted groups and may omit more frequent unadmitted groups. Text/NDJSON search streams output and suits larger results. Dedicated Ubuntu reference performance remains unverified; earlier Windows measurements are environment-specific, not universal claims.

## Exit statuses

| Status | Meaning |
| --- | --- |
| 0 | Complete result |
| 1 | Complete search without matches |
| 2 | Invalid usage/options |
| 3 | Usable partial coverage |
| 4 | I/O/security/output/invariant failure |
| 130 / 143 | SIGINT / SIGTERM where supported |
| 141 | Quiet closed stdout pipe |

Only0/1/3 may commit output files. Display limits alone do not make coverage partial. Partial takes precedence over no matches.

## Development and contribution

From the source tree with Node24/npm:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:native
npm run check
npm run verify:release-docs
npm run verify:package
npm run security:filesystem
```

`check` runs strict type checking, lint, compilation and complete Vitest tests. `verify:package` inspects a real tarball, installs it offline with an empty isolated cache, verifies installed bytes and user commands through the npm shim, then uninstalls. Schema validation uses development tooling; the distributed CLI needs none. Verify an existing exact archive with `npm run verify:package -- ./artifacts/thebraz-loglens-0.1.0-beta.1.tgz`.

The Windows workflow runs the complete Windows gates with read-only repository
permissions and immutable Action references. The separate manual multiplatform
workflow retains unfinished Stage 4 checks. Windows Server CI is distinct from
Windows 11; shared CI does not satisfy dedicated Ubuntu performance gates. Prepared
workflows are not evidence of a successful remote run.

Read [CONTRIBUTING](CONTRIBUTING.md), AGENTS.md and the relevant source-tree contracts
before contributing. Keep logs, credentials, local evidence and archives out of
source control. See [SECURITY](SECURITY.md) before reporting a vulnerability.

## License and release state

[MIT](LICENSE), copyright 2026 Braz, retained from the owner's documented selection.
See [CHANGELOG](CHANGELOG.md), [release notes](docs/RELEASE_NOTES.md) and
[supported platforms](docs/SUPPORTED_PLATFORMS.md). The Windows GitHub pre-release
is owner-authorized subject to its gates; npm publication remains unauthorized.
