# Maintenance recording

**Feature.** The Corvette profile accepts vehicle-scoped maintenance records with service, date, mileage, cost and notes.

**Sequence.** Open the Corvette, scroll to its maintenance log, add a demo oil and filter service, save, read the record, and reload the profile.

**Checks.** The saved item displays the demonstration mileage and exact USD amount. The record survives reload and is visible in a new Chromium context connected to the same local database. The separate API tests exercise owner and vehicle scoping. All entered values are demo-only.

**Source.** [Maintenance PR #3](https://github.com/pilercodes/virtual-garage/pull/3), maintenance commit `3c2a321`, recording automation commit `03e2c09`. The CI browser uses local SQLite, so this verifies separate browser contexts against the project backend. Sites D1 and cross-device persistence are pending.

**Optional motion graphic.** Use a four-second dark close-up of an orange service-log line stepping through an icon, date and cost as the camera slides gently downward. Finish with the line settling into the actual record row via a cross-dissolve. Place it between the form interaction and the explanation of persistent storage.
