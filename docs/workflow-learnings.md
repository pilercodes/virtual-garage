# Workflow learnings

## Virtual Garage

Cloning and reading worked before pushing. The cloud HTTPS push returned 403 until the repository was connected in the environment settings. The successful disposable-branch push was confirmed and removed without changes to main. A fine-grained token was unnecessary.

At workflow inspection, GitHub reported automatic merge disabled and no repository rulesets. The branch-protection REST read returned 403 for the integration. Treat required review and status enforcement as unverified until the repository owner or an authorized integration can configure and prove those controls.

## Reusable lessons

Verify clone, CLI authentication, and push separately. Check branch and ruleset permissions before depending on auto-merge. Build deployment artifacts from an approved immutable Git SHA and retain the release mapping. Keep independent review records separate from implementation self-checks.
