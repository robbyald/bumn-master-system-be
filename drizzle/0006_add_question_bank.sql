CREATE TABLE `question_bank` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`subcategory` text NOT NULL,
	`difficulty` text NOT NULL,
	`question` text NOT NULL,
	`options` text NOT NULL,
	`correct_answer` text,
	`explanation` text,
	`source` text DEFAULT 'goldset' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `question_bank_category_idx` ON `question_bank` (`category`);--> statement-breakpoint
CREATE INDEX `question_bank_subcategory_idx` ON `question_bank` (`subcategory`);--> statement-breakpoint
CREATE INDEX `question_bank_difficulty_idx` ON `question_bank` (`difficulty`);
