# Performance and resource specification

Reference release targets remain **UNVERIFIED / NOT TESTED**. Actual Windows smoke measurements are separately recorded in [Stage 2 acceptance](STAGE_2_ACCEPTANCE.md) and [benchmark evidence](../evidence/stage-2/benchmarks.json). Values below are required design limits or proposed release acceptance targets, not benchmark results. MiB/GiB mean powers of 1024; byte limits apply before output escaping unless stated otherwise.

Stage 3 adds [actual Windows large-file/fuzz/resource evidence](AUDIT_REPORT.md), including a repaired HTML expansion case that previously exceeded 512 MiB RSS. HTML size is counted after escaping but before allocating the expanded report; escaping uses bounded blocks and clipped prefixes are copied once. This local evidence does not replace the reference environment or waive its gates.

## Binding default limits

V1 has fixed documented limits, not a tuning flag for each internal buffer. Changes require synchronized security, CLI, analysis, and test updates.

| Resource | Limit and behavior |
| --- | --- |
| Discovered sources | 1024 explicit unique paths plus stdin within that total; excess is usage error |
| Reader/decompressor high-water mark | 64 KiB per stream; implementation MUST account for Node/zlib internal buffers separately |
| Physical line | 1 MiB decompressed bytes excluding separator; on excess retain first 64 KiB and drain/hash remainder |
| Multiline event/raw retention | 4 MiB bytes; excess retains first 64 KiB, drains continuations, and marks damaged |
| Message | 16 KiB UTF-8; prefix at character boundary, diagnostic if reduced |
| Original severity token | 16 KiB UTF-8; prefix and `FIELD_TOO_LARGE` on excess |
| Service/logger | 256 UTF-8 bytes each; oversize becomes null with `FIELD_TOO_LARGE` |
| Correlation ID | 512 UTF-8 bytes each; oversize becomes null with `FIELD_TOO_LARGE` to prevent false joins |
| Attributes | 64 KiB canonical UTF-8 JSON, depth 32, total 10000 key/value or array-element nodes; excess discards attributes with `METADATA_LIMIT` |
| Diagnostics per event | 64 retained tuples; first 63 encountered plus `DIAGNOSTICS_LIMIT` at the first omitted line; fixed set of observed codes still supplies exact per-code/event totals |
| Event export projection | 64 KiB serialized JSON per projected event, including escaped content; deterministic field reduction per [SECURITY_MODEL](SECURITY_MODEL.md) |
| Group representative | 8 KiB serialized projected event; omit attributes/raw, then shorten message; retain IDs/positions and `displayTruncated` |
| Search context | Before/after each 0–100 events; prior-window retention max 101 projected events and 8 MiB, including bookkeeping |
| Error group keys | 10000 admitted unique tuples; new keys beyond limit count in overflow |
| Correlation keys | 10000 admitted `(kind,value)` keys, independent of error groups |
| Temporal buckets | 10000 admitted bucket starts; new starts count in overflow |
| Combined aggregation retention | 64 MiB accounted state across all maps/representatives; admission checks use serialized retained bytes plus 512 bytes per entry; reject new state if insufficient |
| Each input source | 10 GiB decompressed; excess stops source as partial |
| Entire run | 50 GiB decompressed; excess cancels further reading as partial |
| Gzip expansion | Max 200:1 decompressed/compressed bytes once decompressed output exceeds 1 MiB; checked after every output chunk; excess stops source |
| Encoded gzip bytes (D18) | Independently cap compressed bytes at 10 GiB/source and 50 GiB across gzip sources/run, including headers that produce no decoded bytes; existing SOURCE_BYTE_LIMIT/RUN_BYTE_LIMIT outcomes apply |
| Report / aggregate serialization | 32 MiB UTF-8 output; exceed before commit = output failure, exit 4; stdout may contain an incomplete document |
| JSON search result retention | 32 MiB serialized projected events plus bounded envelope state in memory; check before admission; no disk spool; excess is output failure, recommend NDJSON |
| Event stream output | No total byte cap; per-record cap and writable backpressure apply |

Limit overshoot from one already-delivered reader/decompressor chunk is bounded by 64 KiB plus runtime-internal buffering. Consumed bytes include that chunk; accepted record boundaries and coverage MUST remain truthful. Drain-to-boundary cannot bypass source/run/ratio limits. Closing a capped source is preferable to draining arbitrary attacker-controlled bytes.

## Streaming guarantees

Readers MUST open one input at a time. Parsing MUST retain no whole-file copy, line list, or historical event list. A command MAY hold one pending event, bounded search context, and the explicitly bounded maps; JSON search additionally retains only its capped projected output. `inspect` has no group map; `group` retains only its selected grouping mode; `report` retains bounded groups, correlation summaries, and temporal counts. These algorithms use bounded retained state, but runtime memory includes GC, decoded strings, transient JSON trees, serialization, and decompressor allocations.

The CLI MUST await downstream writes/drain events and stop pulling input when stdout/file output applies backpressure. At most one reader, one output destination, and one temporary output file may be open for data I/O at once; standard streams and runtime-internal handles are excluded. A file output uses the temp descriptor until atomic commit, not two simultaneous output data descriptors.

Aggregation admission checks MUST also cap retained bytes, not only key counts. Reserve maximum serialized growth of count/time scalar fields before admission, in addition to serialized retained data and the 512-byte entry allowance. Existing admitted keys keep exact counts after saturation; unadmitted keys contribute to exact overflow-event counters. No eviction silently changes a bucket's meaning. Input counters continue after aggregation saturation.

Encoded gzip caps are independent of decoded counters: public bytesRead and provenance remain decompressed bytes only. Compressed bytes rejected before zlib emits output do not become fabricated decoded progress or events. The encoded run cap counts gzip sources; the existing decoded run cap continues to count all sources. These fixed caps add no public tuning flags.

SIGINT/SIGTERM cancellation MUST stop new reads, close active streams, discard temporary output, and complete within 2 seconds on the supported local-filesystem benchmark environment. Stalled network filesystems are outside that latency claim. [CLI_CONTRACT](CLI_CONTRACT.md) defines observable interrupted output/status.

## Measurement targets

Reference environment: Ubuntu 24.04 x64, Node 24.x exact version recorded, 4 dedicated modern CPU cores, 8 GiB RAM, local SSD, no competing workload. Record CPU model, storage, OS, versions, compression ratio, warm/cold-cache condition, command, dataset digest, event count, bytes, and result checksum.

| Workload | Proposed mandatory release target |
| --- | --- |
| 1 GiB JSONL, 1 KiB mean record, inspect to JSON file | Median end-to-end throughput ≥20 MiB/s decompressed; peak RSS ≤256 MiB |
| 1 GiB text with 10% multiline traces, group/report | Median throughput ≥10 MiB/s; peak RSS ≤512 MiB |
| Gzip version of normal JSONL, ratio approximately 5:1 | Median throughput ≥10 MiB/s decompressed; peak RSS ≤512 MiB |
| 5 GiB repeated JSONL under per-source limit | Exact counters; peak RSS ≤256 MiB for inspect; no input-size-proportional memory growth |
| High cardinality/adversarial bounded sources | Peak RSS ≤512 MiB, all limit outcomes accounted, no crash/hang; throughput floor not asserted |
| Slow output consumer | Correct results, bounded retained state, no continuing unbounded input pull |

Search event rendering is output-bound: benchmark input and output bytes separately. No universal terminal throughput promise. RSS includes all Node process allocations; record peak through an OS sampler, not `heapUsed` alone. Child processes, if any exist for measurement, MUST be included and explained; implementation must not spawn per-record processes.

## Reproducible procedure (future Stage 2/3 work)

Create deterministic synthetic datasets from recorded seeds and publish generation parameters plus expected counts. Normal: JSONL/text, 7 severities, known times/IDs, bounded groups. Stress: 1/5 GiB, 100000 unique groups, shuffled timestamps, long traces, high identifier cardinality. Adversarial: over-limit line/event, deep objects, malformed UTF-8/JSON, gzip bomb, corrupt gzip, terminal/HTML payloads, and slow sink. No real production secrets.

Run one warm-up and five measured runs per dataset/command; record each result, median elapsed time, throughput, peak RSS, status, counters, overflow, and deterministic output hash. Include full read/parse/analyze/render/write time; omit setup and dataset generation. Fix caching condition across comparisons. On Windows/macOS execute correctness plus smoke memory/cancellation checks; report platform-specific measurements without pretending they are reference throughput results.

Stage 2 MUST supply actual benchmark evidence. Stage 3 MUST repeat affected measurements after hardening. Failed targets are release blockers until remediated or deliberately revised with measured rationale and explicit acceptance. This pre-stage MUST NOT generate datasets, execute benchmarks, or claim numerical results.

A real streamed 5-GiB repeated-JSONL correctness/memory run is available separately through `node benchmarks/large.mjs`. It generates exactly 5242880 events in 64-KiB blocks, checks original byte/event/severity/time totals and hashes, records OS RSS for both CLI and generator driver, and persists no input dataset. It is a single Windows correctness run, not the repeated Ubuntu reference acceptance procedure.
