CREATE TRIGGER workshop_cleanup_removed_steps
AFTER UPDATE OF details ON maintenance
BEGIN
  DELETE FROM garage_files
  WHERE owner = NEW.owner AND vehicle_id = NEW.vehicle_id AND target LIKE 'step:' || NEW.id || ':%'
    AND NOT EXISTS (SELECT 1 FROM json_each(NEW.details, '$.steps')
      WHERE garage_files.target = 'step:' || NEW.id || ':' || json_extract(value, '$.id'));
END;
--> statement-breakpoint
CREATE TRIGGER workshop_guard_record_delete
BEFORE DELETE ON workshop_records
WHEN (OLD.kind = 'part' AND (
  EXISTS (SELECT 1 FROM maintenance m, json_each(m.details, '$.partIds') j WHERE m.owner = OLD.owner AND m.vehicle_id = OLD.vehicle_id AND j.value = OLD.id)
  OR EXISTS (SELECT 1 FROM workshop_records p, json_each(p.data, '$.partIds') j WHERE p.kind = 'project' AND p.owner = OLD.owner AND p.vehicle_id = OLD.vehicle_id AND j.value = OLD.id)))
  OR (OLD.kind = 'schedule' AND EXISTS (SELECT 1 FROM maintenance m WHERE m.owner = OLD.owner AND m.vehicle_id = OLD.vehicle_id AND json_extract(m.details, '$.scheduleId') = OLD.id))
BEGIN
  SELECT RAISE(ABORT, 'Workshop relationship changed');
END;
--> statement-breakpoint
CREATE TRIGGER workshop_guard_log_delete
BEFORE DELETE ON maintenance
WHEN EXISTS (SELECT 1 FROM workshop_records p, json_each(p.data, '$.logIds') j
  WHERE p.kind = 'project' AND p.owner = OLD.owner AND p.vehicle_id = OLD.vehicle_id AND j.value = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'Workshop relationship changed');
END;
--> statement-breakpoint
CREATE TRIGGER workshop_guard_maintenance_insert
BEFORE INSERT ON maintenance
WHEN EXISTS (SELECT 1 FROM json_each(NEW.details, '$.partIds') j
  WHERE NOT EXISTS (SELECT 1 FROM workshop_records r WHERE r.owner = NEW.owner AND r.vehicle_id = NEW.vehicle_id AND r.kind = 'part' AND r.id = j.value))
  OR (COALESCE(json_extract(NEW.details, '$.scheduleId'), '') != '' AND NOT EXISTS
    (SELECT 1 FROM workshop_records r WHERE r.owner = NEW.owner AND r.vehicle_id = NEW.vehicle_id AND r.kind = 'schedule' AND r.id = json_extract(NEW.details, '$.scheduleId')))
BEGIN
  SELECT RAISE(ABORT, 'Workshop relationship changed');
END;
--> statement-breakpoint
CREATE TRIGGER workshop_guard_workshop_records_insert
BEFORE INSERT ON workshop_records
WHEN NEW.kind = 'project' AND (
  EXISTS (SELECT 1 FROM json_each(NEW.data, '$.partIds') j
    WHERE NOT EXISTS (SELECT 1 FROM workshop_records r WHERE r.owner = NEW.owner AND r.vehicle_id = NEW.vehicle_id AND r.kind = 'part' AND r.id = j.value))
  OR EXISTS (SELECT 1 FROM json_each(NEW.data, '$.logIds') j
    WHERE NOT EXISTS (SELECT 1 FROM maintenance m WHERE m.owner = NEW.owner AND m.vehicle_id = NEW.vehicle_id AND m.id = j.value)))
BEGIN
  SELECT RAISE(ABORT, 'Workshop relationship changed');
END;
--> statement-breakpoint
CREATE TRIGGER workshop_guard_maintenance_update
BEFORE UPDATE ON maintenance
WHEN EXISTS (SELECT 1 FROM json_each(NEW.details, '$.partIds') j
  WHERE NOT EXISTS (SELECT 1 FROM workshop_records r WHERE r.owner = NEW.owner AND r.vehicle_id = NEW.vehicle_id AND r.kind = 'part' AND r.id = j.value))
  OR (COALESCE(json_extract(NEW.details, '$.scheduleId'), '') != '' AND NOT EXISTS
    (SELECT 1 FROM workshop_records r WHERE r.owner = NEW.owner AND r.vehicle_id = NEW.vehicle_id AND r.kind = 'schedule' AND r.id = json_extract(NEW.details, '$.scheduleId')))
BEGIN
  SELECT RAISE(ABORT, 'Workshop relationship changed');
END;
--> statement-breakpoint
CREATE TRIGGER workshop_guard_workshop_records_update
BEFORE UPDATE ON workshop_records
WHEN NEW.kind = 'project' AND (
  EXISTS (SELECT 1 FROM json_each(NEW.data, '$.partIds') j
    WHERE NOT EXISTS (SELECT 1 FROM workshop_records r WHERE r.owner = NEW.owner AND r.vehicle_id = NEW.vehicle_id AND r.kind = 'part' AND r.id = j.value))
  OR EXISTS (SELECT 1 FROM json_each(NEW.data, '$.logIds') j
    WHERE NOT EXISTS (SELECT 1 FROM maintenance m WHERE m.owner = NEW.owner AND m.vehicle_id = NEW.vehicle_id AND m.id = j.value)))
BEGIN
  SELECT RAISE(ABORT, 'Workshop relationship changed');
END;
--> statement-breakpoint
CREATE TRIGGER workshop_guard_file_insert
BEFORE INSERT ON garage_files
WHEN NOT (
  NEW.target = 'vehicle'
  OR EXISTS (SELECT 1 FROM maintenance m WHERE m.owner = NEW.owner AND m.vehicle_id = NEW.vehicle_id
    AND (NEW.target IN ('log:' || m.id, 'receipt:' || m.id, 'warranty:' || m.id)
      OR EXISTS (SELECT 1 FROM json_each(m.details, '$.steps') WHERE NEW.target = 'step:' || m.id || ':' || json_extract(value, '$.id'))))
  OR EXISTS (SELECT 1 FROM workshop_records r WHERE r.owner = NEW.owner AND r.vehicle_id = NEW.vehicle_id
    AND ((r.kind = 'part' AND NEW.target IN ('part:' || r.id, 'part-warranty:' || r.id))
      OR (r.kind = 'project' AND NEW.target = 'project:' || r.id)))
)
BEGIN
  SELECT RAISE(ABORT, 'Workshop relationship changed');
END;
