# Publication — Windows GitHub experimental beta

The owner's 2026-10-14 request authorizes Git initialization/commits/tag, creation of
public `thebraz/LogLens`, verified source push and GitHub pre-release `v0.1.0-beta.1`
with the tested Windows archive and SHA-256 file. It does not authorize npm publication;
keep `private:true` and never run `npm publish`.

Release title: `LogLens v0.1.0-beta.1 — Windows Experimental Beta`.
Original multiplatform Stage 4 remains PARTIAL; see STAGE_4_ACCEPTANCE.md.

1. Audit exact Windows source, native provenance, dependencies and workflow; correct
   actual defects without weakening security requirements.
2. Pass clean install/native build/typecheck/lint/build/full tests, filesystem/ACL/
   Ctrl+C, CLI/schema, advisory and exact archive/offline-installed-shim checks.
   Disclose both POSIX skips. Bind reused fuzz/5-GiB evidence to unchanged bytes;
   rerun affected verification when implementation changes.
3. Review prospective tracked source for secrets, local data, archives, generated
   files and unsuitable audit artifacts. Preserve excluded local originals.
4. Build the final archive once, record SHA-256 and SHA256SUMS.txt, and verify actual
   installation/execution of those exact bytes. Changes invalidate affected evidence.
5. Commit/push reviewed source and observe successful Windows CI on that exact commit.
   Prepared workflows or another commit's run are not PASS. Infrastructure/authentication
   failure blocks release and must be disclosed.
6. Only after all gates, create/push annotated tag v0.1.0-beta.1 on that commit, create
   the GitHub pre-release and attach only the verified archive/checksum file.
7. Read back the visible release/tag/commit/assets and compare downloaded asset bytes
   against approved SHA-256 before reporting PUBLISHED.

The owner restated the GitHub authorization directly in chat on 2026-10-14 after
initial approval review rejected the attachment-based request. The public repository
was then created and its identity/visibility verified. Remote CI stays NOT TESTED
until it actually runs. The release and Actions records bind final tag/commit/assets;
WINDOWS_BETA_ACCEPTANCE.md records the local and pre-publication evidence.

No npm authority/name-availability claim follows from the GitHub account. Full native,
runtime/package/CI matrix, Ubuntu reference performance, engine checks and npm readiness
remain required by the original specification.
