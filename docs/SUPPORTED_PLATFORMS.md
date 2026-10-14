# Supported platforms — 0.1.0-beta.1

| Environment | Windows experimental beta | Original Stage 4 |
| --- | --- | --- |
| Windows 11 x64, Node.js 24.x | Candidate under verification | Windows local evidence only |
| Windows Server 2025 x64, Node.js 24.x | CI validation environment, remote result required | Does not replace Windows 11 local checks |
| Ubuntu 24.04 x64 | Not validated or supported by this beta | Runtime/security/package/reference-performance gates open |
| macOS 14+ arm64 | Not validated or supported by this beta | Safe output incomplete; native/package gates open |
| Other OSes, architectures or Node majors | Unsupported | Not validated |

The Windows artifact contains only `native/win32-x64`. Consumers need no native
compiler, install hook or download. The CLI makes no network requests. Native input
and file output fail closed if their platform backend is missing or incompatible.
Potential stdin/stdout functionality on another OS is not beta support.

The original Stage 4 remains PARTIAL: Ubuntu reference testing and dedicated
performance, Linux native runtime, macOS safe output/native runtime, full binary
matrix, cross-platform final-artifact installation, remaining engine compatibility,
multiplatform CI and npm readiness are still required. This restricted GitHub
milestone does not remove or satisfy those requirements. npm is not published.
