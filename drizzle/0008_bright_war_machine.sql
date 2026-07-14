CREATE TABLE `repair_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`run_id` text NOT NULL,
	`status` text DEFAULT 'ready_for_review' NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`files_json` text DEFAULT '[]' NOT NULL,
	`tests_json` text DEFAULT '[]' NOT NULL,
	`risks_json` text DEFAULT '[]' NOT NULL,
	`created_by` text NOT NULL,
	`reviewer_email` text,
	`decision_note` text,
	`requested_at` text,
	`approved_by` text,
	`approved_at` text,
	`pr_status` text DEFAULT 'not_requested' NOT NULL,
	`branch_name` text,
	`pr_url` text,
	`pr_number` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `simulation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repair_proposals_run_idx` ON `repair_proposals` (`run_id`);