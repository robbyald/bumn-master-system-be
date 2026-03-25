CREATE TABLE `user_package` (
	`user_id` text NOT NULL,
	`package_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_package_userId_idx` ON `user_package` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_package_packageId_idx` ON `user_package` (`package_id`);