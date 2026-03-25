CREATE TABLE `user_point_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_point_history_userId_idx` ON `user_point_history` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_point_history_createdAt_idx` ON `user_point_history` (`created_at`);