# Contributing

LogLens 0.1.0-beta.1 is an experimental Windows x64 beta requiring Node.js 24.x.
Read AGENTS.md and the relevant docs/ contracts before changing observable behavior.
Keep parsing/analysis separate from I/O, preserve provenance and bounded streaming,
and use synthetic fixtures. Do not add telemetry or runtime network access.

Development also requires Python, a supported C++ build toolchain and Node headers:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build:native
npm run check
pwsh -NoProfile -File scripts/verify-windows.ps1
npm run verify:stage2
```

`verify-windows.ps1` performs another clean installation and native build, then
typecheck/lint/build/tests, documentation, filesystem, ACL, native Ctrl+C, advisory
and isolated package gates. Review the exact generated archive before distribution.
An existing archive can be tested with `npm run verify:package -- <archive.tgz>`.

Use small changes and relevant regressions, preserve security assertions, and record
PASS/FAIL/NOT TESTED with actual environment evidence. Avoid real logs, credentials,
personal data, generated build trees and local audit archives in contributions.
Linux/macOS are not supported by this beta; the original multiplatform requirements
remain open. Opening an issue or pull request does not authorize a release or npm
publication. Do not disclose security details in public issues; see SECURITY.md.
