CREATE TABLE `data_deletion_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`scope` text DEFAULT 'workspace' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`execute_after` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`canceled_at` text,
	`completed_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `launch_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`check_key` text NOT NULL,
	`passed` integer DEFAULT false NOT NULL,
	`evidence` text,
	`attested_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `launch_checks_workspace_key_idx` ON `launch_checks` (`workspace_id`,`check_key`);