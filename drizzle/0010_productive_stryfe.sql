ALTER TABLE `event_settings` ADD `event_closed_at` integer;--> statement-breakpoint
CREATE TRIGGER event_scheduled_closing AFTER UPDATE OF event_closed_at ON event_settings
WHEN NEW.event_closed_at IS NOT NULL AND OLD.event_closed_at IS NULL
BEGIN
  UPDATE house_settings SET status = 'closed';
  INSERT INTO operational_events
    (category, event_type, severity, house_code, actor, message, count, occurred_at, last_occurred_at)
    VALUES ('activity', 'scheduled_closing_applied', 'info', 'ALL', 'system',
      'Scheduled closing closed all houses and locked station status controls.',
      1, NEW.event_closed_at, NEW.event_closed_at);
END;
