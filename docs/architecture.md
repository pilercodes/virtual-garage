# Architecture

The browser uses vanilla HTML, CSS and JavaScript with same-origin JSON APIs. A Worker serves the page and crosses the storage boundary only with parameterized SQL. Hosted account scope comes from the stable Sites identity header. Local development injects an isolated demo identity and uses SQLite to exercise the same queries and migrations. The static assets are embedded during the build so the Worker entry point can serve them without an external storage service.

The starter vehicles are defaults in source. Edits are persisted as owner-scoped overrides. A new vehicle gets a generated ID. No real records are seeded. Hosted D1 provisioning and migration behavior must be proven before production use.

Maintenance is indexed by account, vehicle, and service date. An added vehicle must belong to the signed-in account before its log can be accessed. Dates are calendar dates, mileage is whole miles, and costs are stored as integer USD cents. Local SQLite is an explicit development database. The production target is Sites D1 with stable per-Site account identity.

## Garage accounts

The application accepts Virtual Garage email-and-password accounts. Email is a login identifier in this release. Email verification and automated password recovery are outside this rollout. Passwords are salted and derived server-side. Sessions use random revocable tokens stored as hashes and HTTPS-only cookies. API authorization uses the session and checks owner or invite membership for each selected garage. A new account has an empty private garage. Owners can give editing access using a one-use link that expires after 24 hours and can remove a member later. An unclaimed link remains valid until it expires. Share it privately.

A private-only transition can move existing records and starter vehicles into a new account. The import requires both a valid app session and the platform-verified prior owner identity and executes atomically. Only enable `LEGACY_IMPORT_ENABLED` on the owner-private Site during this transition. Verify that it is disabled on the deployed version before making the sign-in page publicly reachable.

## Vehicle workshop

Existing maintenance rows stay in the original table. Additive migrations supply activity type, status, optional details and an edit revision, so old rows remain completed maintenance. The Workshop groups procedures, parts, schedules, projects and specifications in an owner-scoped D1 table. Procedures copy written steps into new activity records. Historical photos remain private to their original record. Parts, schedules and projects link to existing IDs. Editing and deleting referenced records uses scoped checks.

The Sites `BUCKET` R2 binding stores original files (large browser photos may be resized before upload). D1 stores their ownership, association, ordering and details. The file API checks garage membership and validates signatures. Deleted file metadata queues object deletion for retry during subsequent successful workshop writes; the local preview uses an ignored directory behind the same storage interface. Attachments are capped at 10 MB each and 250 per vehicle. Printable history and CSV/JSON exports run in the authenticated browser. Per-vehicle ZIP exports include attachments up to 80 MB. Reminders are in-app. There is no automated backup restore or external notification.
