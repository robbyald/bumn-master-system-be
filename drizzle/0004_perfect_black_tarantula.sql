CREATE TABLE `login_attempt` (
	`email` text PRIMARY KEY NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempt_lockedUntil_idx` ON `login_attempt` (`locked_until`);