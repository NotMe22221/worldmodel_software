CREATE TABLE `github_workspace_installations` (
	`workspace_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`account_login` text NOT NULL,
	`account_type` text NOT NULL,
	`repository_selection` text NOT NULL,
	`permissions_json` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`connected_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY (`workspace_id`, `installation_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `github_workspace_installations_workspace_idx` ON `github_workspace_installations` (`workspace_id`,`status`);
--> statement-breakpoint
CREATE TABLE `github_workspace_repositories` (
	`workspace_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`full_name` text NOT NULL,
	`default_branch` text NOT NULL,
	`is_private` integer DEFAULT true NOT NULL,
	`selected` integer DEFAULT false NOT NULL,
	`synced_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY (`workspace_id`, `repository_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`installation_id`) REFERENCES `github_workspace_installations`(`workspace_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `github_workspace_repositories_workspace_idx` ON `github_workspace_repositories` (`workspace_id`,`selected`,`full_name`);
--> statement-breakpoint
INSERT OR IGNORE INTO `github_workspace_installations` (`workspace_id`, `installation_id`, `account_login`, `account_type`, `repository_selection`, `permissions_json`, `status`, `connected_by`, `created_at`, `updated_at`)
SELECT `workspace_id`, `installation_id`, `account_login`, `account_type`, `repository_selection`, `permissions_json`, `status`, `connected_by`, `created_at`, `updated_at`
FROM `github_installations`;
--> statement-breakpoint
INSERT OR IGNORE INTO `github_workspace_repositories` (`workspace_id`, `repository_id`, `installation_id`, `full_name`, `default_branch`, `is_private`, `selected`, `synced_at`)
SELECT gr.`workspace_id`, gr.`repository_id`, gr.`installation_id`, gr.`full_name`, gr.`default_branch`, gr.`is_private`, gr.`selected`, gr.`synced_at`
FROM `github_repositories` gr
JOIN `github_workspace_installations` gi
  ON gi.`workspace_id` = gr.`workspace_id`
 AND gi.`installation_id` = gr.`installation_id`;
