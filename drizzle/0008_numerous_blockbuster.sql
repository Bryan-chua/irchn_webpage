CREATE TABLE `participant_devices` (
	`device_token_hash` text PRIMARY KEY NOT NULL,
	`home_rc` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `event_settings` ADD `home_rc_only_at` integer;--> statement-breakpoint
ALTER TABLE `queue_entries` ADD `home_rc` text;--> statement-breakpoint
ALTER TABLE `queue_entries` ADD `cancellation_reason` text;--> statement-breakpoint
CREATE TRIGGER queue_rc_cutoff_insert BEFORE INSERT ON queue_entries
WHEN NEW.status IN ('waiting', 'skipped')
  AND (NEW.home_rc IS NULL OR NEW.home_rc <> NEW.house_code)
  AND EXISTS (SELECT 1 FROM event_settings WHERE id = 1 AND home_rc_only_at <= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
BEGIN SELECT RAISE(ABORT, 'rc_cutoff'); END;
--> statement-breakpoint
CREATE TRIGGER queue_rc_cutoff_update BEFORE UPDATE OF status ON queue_entries
WHEN (NEW.status IN ('waiting', 'skipped') OR (NEW.status = 'entered' AND OLD.status IN ('waiting', 'skipped')))
  AND (NEW.home_rc IS NULL OR NEW.home_rc <> NEW.house_code)
  AND EXISTS (SELECT 1 FROM event_settings WHERE id = 1 AND home_rc_only_at <= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
BEGIN SELECT RAISE(ABORT, 'rc_cutoff'); END;
