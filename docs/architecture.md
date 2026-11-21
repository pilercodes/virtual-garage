# Architecture

The browser uses vanilla HTML, CSS and JavaScript with same-origin JSON APIs. A Worker serves the page and crosses the storage boundary only with parameterized SQL. Hosted account scope comes from the stable Sites identity header. Local development injects an isolated demo identity and uses SQLite to exercise the same queries and migrations. The static assets are embedded during the build so the Worker entry point can serve them without an external storage service.

The starter vehicles are defaults in source. Edits are persisted as owner-scoped overrides. A new vehicle gets a generated ID. No real records are seeded. Hosted D1 provisioning and migration behavior must be proven before production use.

Maintenance is indexed by account, vehicle, and service date. An added vehicle must belong to the signed-in account before its log can be accessed. Dates are calendar dates, mileage is whole miles, and costs are stored as integer USD cents. Local SQLite is an explicit development database. The production target is Sites D1 with stable per-Site account identity.

## Garage accounts

The application accepts Virtual Garage email-and-password accounts. Email is a login identifier in this release. Email verification and automated password recovery are outside this rollout. Passwords are salted and derived server-side. Sessions use random revocable tokens stored as hashes and HTTPS-only cookies. API authorization uses the session and checks owner or invite membership for each selected garage. A new account has an empty private garage. Owners can give editing access using a one-use link that expires after 24 hours and can remove a member later.

A private-only transition can move existing records and starter vehicles into a new account. The import requires both a valid app session and the platform-verified prior owner identity and executes atomically. Only enable `LEGACY_IMPORT_ENABLED` on the owner-private Site during this transition. Verify that it is disabled on the deployed version before making the sign-in page publicly reachable.
