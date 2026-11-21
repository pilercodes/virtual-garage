# Architecture

The browser uses vanilla HTML, CSS and JavaScript with same-origin JSON APIs. A Worker serves the page and crosses the storage boundary only with parameterized SQL. Hosted account scope comes from the stable Sites identity header. Local development injects an isolated demo identity and uses SQLite to exercise the same queries and migrations. The static assets are embedded during the build so the Worker entry point can serve them without an external storage service.

The starter vehicles are defaults in source. Edits are persisted as owner-scoped overrides. A new vehicle gets a generated ID. No real records are seeded. Hosted D1 provisioning and migration behavior must be proven before production use.
