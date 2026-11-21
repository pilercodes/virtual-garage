# Sites deployment

Repository: [pilercodes/virtual-garage](https://github.com/pilercodes/virtual-garage). Hosting target: an owner-private ChatGPT Site named Virtual Garage. Project ID, live URL, version and source SHA are pending.

Run `npm run build` from the approved GitHub main commit. The expected package includes `.openai/hosting.json` and a Worker entry at `dist/server/index.js`. The manifest declares a D1 binding named `DB`. The production database must receive the checked-in, ordered migrations using the supported Sites deployment path. Verify that this package layout applies the migrations on the actual hosted binding before relying on the database.

Use the Sites connector and source workflow to register the project once, save an archive built from the exact pushed source, and deploy privately. Sites versions require the SHA at the head of the configured Site source branch. If the new Site provisions a separate source repository, use it as a deployment mirror of approved GitHub source. Keep GitHub authoritative and retain the same Site project ID for later updates. Verify deployment status and account-scoped persistence before recording a release. No automatic publishing or hosted persistence has been verified.
