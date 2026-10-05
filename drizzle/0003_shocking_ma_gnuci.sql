ALTER TABLE `queue_entries` ADD `join_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `queue_entries_join_key_unique` ON `queue_entries` (`join_key`);--> statement-breakpoint
CREATE INDEX `idx_queue_house_status_id` ON `queue_entries` (`house_code`,`status`,`id`);--> statement-breakpoint
INSERT OR IGNORE INTO `house_settings` (`house_code`, `status`) VALUES
  ('RV', 'open'),
  ('CP', 'open'),
  ('AC', 'open'),
  ('TM', 'open'),
  ('R4', 'open'),
  ('NS', 'open');
