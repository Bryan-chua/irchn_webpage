CREATE TABLE `announcement` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`published_at` integer NOT NULL
);
