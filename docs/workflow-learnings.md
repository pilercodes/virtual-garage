# Workflow learnings

## Virtual Garage

Cloning and reading worked before pushing. The cloud HTTPS push returned 403 until the repository was connected in the environment settings. The successful disposable-branch push was confirmed and removed without changes to main. A fine-grained token was unnecessary.

At workflow inspection, GitHub reported automatic merge disabled and no repository rulesets. The branch-protection REST read returned 403 for the integration. Treat required review and status enforcement as unverified until the repository owner or an authorized integration can configure and prove those controls.

## Reusable lessons

Verify clone, CLI authentication, and push separately. Check branch and ruleset permissions before depending on auto-merge. Build deployment artifacts from an approved immutable Git SHA and retain the release mapping. Keep independent review records separate from implementation self-checks.

The [controlled PR](https://github.com/pilercodes/virtual-garage/pull/2) reported a failing `Build and test` check while GitHub's pull API reported `mergeable: true` and `mergeable_state: unstable`. The base and main both reported unprotected. Attempting to require the status check on the test base returned GitHub HTTP 403 with `Resource not accessible by integration`. The repaired run passed and returned `clean`. The PR was closed without merging, and its remote branch was removed. Automatic merging stayed disabled.

The hosted Sites connector listed projects successfully. Its version API requires the exact active commit of the Site's configured source branch. The cloud lacks the Sites source helper on disk and the managed preview was denied a loopback bind. Keep the handoff tied to the authoritative Git SHA and test the package in a Sites-enabled Work task when the reviewed main branch is ready. GitHub Actions supplies the real Chromium runner.

The first recording job revealed that `ubuntu-latest` had moved to Ubuntu 26.04, outside the pinned browser's supported matrix. The recording job pins Ubuntu 24.04.
