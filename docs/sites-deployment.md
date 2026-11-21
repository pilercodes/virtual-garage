# Sites deployment

Repository: [pilercodes/virtual-garage](https://github.com/pilercodes/virtual-garage). Hosting target: an owner-private ChatGPT Site named Virtual Garage. Project ID, live URL, version and source SHA are pending.

Run `npm run build` from the approved GitHub main commit. The expected package includes `.openai/hosting.json` and a Worker entry at `dist/server/index.js`. The manifest declares a D1 binding named `DB`. The production database must receive the checked-in, ordered migrations using the supported Sites deployment path. Verify that this package layout applies the migrations on the actual hosted binding before relying on the database.

Use the Sites connector and source workflow to register the project once, save an archive built from the exact pushed source, and deploy privately. Sites versions require the SHA at the head of the configured Site source branch. If the new Site provisions a separate source repository, use it as a deployment mirror of approved GitHub source. Keep GitHub authoritative and retain the same Site project ID for later updates. Verify deployment status and account-scoped persistence before recording a release. No automatic publishing or hosted persistence has been verified.

## Release checklist

1. Protect GitHub `main` with an active ruleset that requires a pull request, an approval from a distinct reviewer, and the `Build and test` check. Set no bypass actors. Confirm a failed check blocks a disposable PR before enabling auto-merge.
2. Approve and merge [dashboard PR #1](https://github.com/pilercodes/virtual-garage/pull/1) with a merge commit. Retarget [maintenance PR #3](https://github.com/pilercodes/virtual-garage/pull/3) to main, rerun checks, and merge after its independent approval. Repeat for any packaging adjustments.
3. In a ChatGPT Work task with Sites and this GitHub repository attached, open the approved main SHA. Create or reuse the owner-private Virtual Garage project via Sites. Save the returned project ID in the tracked manifest through a PR before the release build. Use the Site source helper to push the reviewed Git source state to its configured branch. Keep the GitHub approved commit as the release authority.
4. Run the approved build and automated tests, package the Worker and hosting manifest using the Sites source workflow, and confirm the supported D1 migration format for this Worker. The local migration tests establish SQL compatibility only. Save and deploy privately against the exact pushed source SHA, then record the project ID, URL, version, GitHub SHA and Sites SHA.
5. Sign in as owner, add a labeled demonstration record, reload, and open a separate signed-in session. Verify the record and test signed-out access. Repeat after an approved improvement is deployed to the same Site ID and URL. Preserve the existing database and append migrations only.
6. Record whether private publication uses an explicit Sites action or a supported publish-on-push window. GitHub Actions in this repository do not publish.

### Resume prompt

> Continue Virtual Garage from pilercodes/virtual-garage after its required GitHub reviews and checks pass. Use only the approved main commit as application source. Open the Sites skill's repository workflow, register or reopen the same private Virtual Garage Site, verify Worker artifact and D1 migration compatibility, and deploy privately. Record the exact SHA, Site ID, version and URL. Verify owner sign-in and persistence across sessions, then run the same-Site update proof from a subsequent reviewed GitHub release. Do not generate another application from the description.

## Initial private deployment

- Live owner-only URL: https://virtual-garage.shawnhogan84.chatgpt.site
- Sites project: `appgprj_6b01de1e1d148191bb842cb4d38b147c`
- GitHub application source: `19f0d0f` (merged PR #1)
- Sites source: `e4e346088981af73fc0155dcbddb9f3f4d850061` (same application files plus the Sites project ID)
- Sites version: `appgprj_6b01de1e1d148191bb842cb4d38b147c~appgver_8ee8374585e8819181c7defee1fac5db`

Sites returned a successful private deployment, and the hosted URL showed the ChatGPT sign-in gate. The Sites database inspection returned the declared DB binding with no tables. Repackaging under the same SHA reused the existing saved version. The next release needs a fresh approved source commit with the tracked Drizzle migration layout. Verify both tables on the hosted binding before testing writes or reporting the app ready.
