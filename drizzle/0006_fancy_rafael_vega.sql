CREATE TABLE `moderator_login_attempts` (
	`attempt_key` text PRIMARY KEY NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`window_started_at` integer NOT NULL,
	`last_failed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_moderator_login_attempts_last_failed` ON `moderator_login_attempts` (`last_failed_at`);