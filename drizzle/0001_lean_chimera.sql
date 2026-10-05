CREATE INDEX IF NOT EXISTS `idx_queue_house_status_joined` ON `queue_entries` (`house_code`,`status`,`joined_at`);
