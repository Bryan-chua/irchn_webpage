CREATE TABLE `event_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`station_controls_locked` integer DEFAULT false NOT NULL,
	`event_end_at` integer,
	`updated_at` integer NOT NULL,
	`updated_by` text DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operational_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`event_type` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`house_code` text DEFAULT 'ALL' NOT NULL,
	`actor` text DEFAULT 'system' NOT NULL,
	`message` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`occurred_at` integer NOT NULL,
	`last_occurred_at` integer NOT NULL,
	`acknowledged_at` integer,
	`acknowledged_by` text,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_operational_events_recent` ON `operational_events` (`last_occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_operational_events_category` ON `operational_events` (`category`,`resolved_at`,`acknowledged_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_operational_events_active_alert` ON `operational_events` (`event_type`,`house_code`) WHERE "operational_events"."category" = 'alert' AND "operational_events"."resolved_at" IS NULL;--> statement-breakpoint
CREATE TABLE `station_presence` (
	`house_code` text PRIMARY KEY NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_login_at` integer NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `event_settings` (`id`, `status`, `station_controls_locked`, `updated_at`, `updated_by`)
VALUES (1, 'open', false, (unixepoch() * 1000), 'migration');
