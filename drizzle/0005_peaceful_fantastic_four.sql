CREATE TABLE `exam_package` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`price` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`categories` text NOT NULL,
	`total_questions` integer NOT NULL,
	`type` text NOT NULL,
	`is_popular` integer DEFAULT false NOT NULL,
	`education_level` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exam_package_type_idx` ON `exam_package` (`type`);--> statement-breakpoint
CREATE INDEX `exam_package_popular_idx` ON `exam_package` (`is_popular`);