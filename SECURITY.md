# Security

## Supported release scope

0.1.0-beta.1 is an experimental Windows 11 x64 beta with Node.js 24.x. Linux and
macOS are unvalidated and unsupported by this beta. It is not production-ready.
The original multiplatform Stage 4 remains PARTIAL. See docs/WINDOWS_BETA_ACCEPTANCE.md
for actual candidate checks and docs/SECURITY_MODEL.md for required controls.

## Reporting

Do not include real credentials, production logs, personal or health data in public
issues. Use GitHub's private vulnerability reporting if available on the repository;
otherwise request a private reporting channel without posting exploit details.
No response-time commitment or private contact address is established here.

Provide the version, Windows/Node versions, affected command, a minimized synthetic
reproducer, expected/actual behavior and filesystem prerequisites. Never test using
another person's files or credentials.

## Boundaries and limitations

The CLI operates locally without telemetry, network requests, a server or database.
Untrusted logs and path components must not execute code, overwrite existing files,
redirect traversal through reparse points or cause unbounded retained state.
Windows input/output uses retained native handles and atomic no-replace publication.
Missing/incompatible native images fail closed without pathname fallback.

Default redaction detects defined credential patterns; it does not guarantee removal
of personal, health, custom, encoded, fragmented or short secrets. Review output before
sharing. Fingerprints reveal equality and may permit guesses. Paired sensitive-output
flags deliberately disable pattern protection; escaping and filesystem rules remain.
Windows ACLs govern file privacy. Crash/power loss may leave owned temporary output.
Same-size concurrent input overwrites cannot be detected. A compromised OS, runtime,
operator account or hostile administrator is outside the threat model.

For source review, report source-backed security defects and distinguish historical
audit failures from the current native implementation. Do not call platform skips
passes or weaken required tests to permit publication.
