# Release and distribution specification

Restricted milestone, owner-requested 2026-10-14: Windows x64 experimental beta may
be distributed as an authorized GitHub pre-release only after its Windows acceptance
and actual remote CI pass. Keep private:true and npm unpublished. The original full
multiplatform release requirements below remain binding and unresolved; Stage 4 stays
PARTIAL. See [publication](PUBLICATION.md) and [Windows acceptance](WINDOWS_BETA_ACCEPTANCE.md).

Status: release requirements only. Stage 1 has private local package scaffolding and verified development-tool installation; no release package identity, owner, public license, repository identity, registry availability, CI run, distributable installation or publication is verified. Stage 4 preparation does not authorize publication.

## Package contract

The npm package MUST contain built ESM JavaScript, declarations only if a supported programmatic API is deliberately added (not required V1), README, LICENSE, CHANGELOG, package metadata, and the stable public contract documentation needed by users. No source code is required in the published tarball. The executable key is `loglens`, pointing to built `dist/bin.js` with a Node shebang and executable permission on POSIX. Metadata MUST set `type=module`, `engines.node=">=24 <25"`, bin, files allowlist, version, accurate description, license, and confirmed repository/bugs/homepage identities. Do not invent maintainer names, emails, URLs, copyright ownership, or funding links.

Default starting package version is `0.1.0` for foundation development; complete verified V1 release is `1.0.0`. Earlier preview versions MUST disclose missing stages. The package name is unresolved until registry availability and ownership are checked; `loglens` is the CLI/product name, not an availability assertion. A scoped registry name MAY preserve the same executable name. Name choice must precede the final package build, not Stage 1 parsing work.

Runtime dependencies SHOULD be zero, following [ENGINEERING_DECISIONS](ENGINEERING_DECISIONS.md). If justified dependencies exist, pin reproducible resolution in a lockfile, review license/advisories/lifecycle scripts, and include them in clean-install testing. Development-only TypeScript/type tooling MAY be installed in Stage 1 once that stage is authorized. Do not introduce install-time downloads, telemetry, optional daemon services, or executable postinstall hooks. Owner-authorized D19 permits a narrowly scoped Node-API filesystem addon to enforce the existing security invariants. Prebuilt platform binaries and provenance manifests are packaged explicitly; consumer installs MUST NOT compile or download binaries. Missing/incompatible backends fail closed, never fall back to pathname checks. Every mandatory platform still needs native and installed-package evidence before release.

## Versioning and documentation

After 1.0, breaking CLI syntax/defaults/statuses, output types/meanings, parser equivalence rules, redaction opt-out behavior, or supported runtime range require package major version. New backward-compatible functionality is minor; compatible fixes are patch. Security fixes that alter documented output MUST explicitly describe compatibility impact. Event/output schema majors follow [DATA_CONTRACT](DATA_CONTRACT.md); adding severity enum values is breaking. Fingerprint algorithm changes require a new algorithm version and migration notes, never silent key drift.

README MUST describe installation, Node support, actual available commands/examples, stdin/gzip, source ordering, time assumptions, partial/no-match exit codes, redaction limitations and sensitive flags, resource caps, static reports, and absence of telemetry. It MUST distinguish implemented behavior and future scope. CHANGELOG MUST link release version/date to concrete changes and compatibility notes; no invented prior release history.

LICENSE requires the owner's explicit license selection and accurate copyright holder before distributable release. Do not assume MIT merely because tooling uses it. License/package identity are unresolved release blockers; they do not prevent Stage 1 from starting after authorization.

## CI and final artifact validation

GitHub Actions belongs to Stage 4 after a real GitHub repository is configured. Workflows MUST use minimum read permissions for validation, reviewed immutable action references, supported OS/Node matrix, reproducible dependency install, typecheck/build/tests, packed-artifact inspection, and clean tarball installation. No untrusted pull-request code receives registry credentials or privileged publication permissions. Publication workflow, if introduced with authorization, MUST have a separate protected/manual gate and exact artifact identity. CI must not claim unavailable runners or measurements passed.

Required release procedure:

1. Resolve license and registry identity, align help/README/schema/docs with the final implementation, and confirm Stage 1–3 evidence. No mandatory FAIL/NOT TESTED remains.
2. Build from a clean controlled workspace using lockfile resolution. Run typecheck and relevant complete checks; record exact source/build identity. No global workspace dependencies may be accidentally required by consumers.
3. Run package dry-run, inspect the real generated tarball file list and contents, and enforce the files allowlist. Exclude `.env`, logs, raw fixtures with sensitive data, caches, local notes, credentials, test datasets, and absolute local paths. Sourcemaps SHOULD be excluded unless reviewed for path/data exposure.
4. Generate the tarball once; record its SHA-256, package metadata, file list, and size. Install that exact tarball into fresh isolated directories without registry access for the package itself; if runtime dependencies exist, use a controlled cache/mirror and report any external resolution.
5. Invoke the installed `loglens` shim on each supported OS. Verify help/version, inspect/search/group/report, stdin/gzip, partial/no-match status, redaction/injection safety, output files, clean uninstall, and no input mutation. Successful build or local source invocation is insufficient.
6. Record release readiness in Markdown with explicit PASS/FAIL/NOT TESTED rows, outstanding blockers, tarball hash, tested OS/Node versions, and measured targets. Do not publish yet.
7. Obtain explicit user authorization identifying package, version, registry, and publication action. Publish only the already-verified tarball; no rebuild between evidence and publishing. Any artifact change invalidates its package evidence.
8. After authorized publication, install the registry version in a fresh directory, compare registry integrity/package identity to the approved artifact, run installed help/version and representative stdin/gzip/report/redaction checks, verify README/license availability, and record actual results. Failed registry verification is a release incident; do not silently republish altered bytes under the same version.

## Release blockers

Missing license/package ownership, unverified registry identity, failed or unexecuted mandatory stage gates, unsupported engine metadata, schema drift, unsafe redaction/escaping/writes, missing package files, secret exposure, nondeterministic promised output, unmeasured/failed performance targets, missing supported-platform package evidence, or missing publication authorization block their respective readiness/publication step.

If GitHub is not configured, local package preparation MAY proceed but required GitHub Actions evidence remains NOT TESTED and release readiness is blocked. No external account, repository, token, remote tag, release, or npm publish is created by this pre-stage.
