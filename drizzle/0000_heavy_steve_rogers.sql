CREATE TABLE `country_progress` (
	`user_email` text NOT NULL,
	`topic` text NOT NULL,
	`country_code` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`correct` integer DEFAULT 0 NOT NULL,
	`streak` integer DEFAULT 0 NOT NULL,
	`mastered` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_email`, `topic`, `country_code`)
);
