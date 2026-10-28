ALTER TABLE `event_settings` ADD `event_open_at` integer;--> statement-breakpoint
ALTER TABLE `event_settings` ADD `event_opened_at` integer;--> statement-breakpoint
CREATE TRIGGER event_scheduled_opening AFTER UPDATE OF event_opened_at ON event_settings
WHEN NEW.event_opened_at IS NOT NULL AND OLD.event_opened_at IS NULL
BEGIN
  UPDATE house_settings SET status = 'open';
  INSERT INTO operational_events
    (category, event_type, severity, house_code, actor, message, count, occurred_at, last_occurred_at)
    VALUES ('activity', 'scheduled_opening_applied', 'info', 'ALL', 'system',
      'Scheduled opening opened all houses and unlocked station status controls.',
      1, NEW.event_opened_at, NEW.event_opened_at);
END;
