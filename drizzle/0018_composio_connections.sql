CREATE TABLE `composio_connection_attempts` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`created_by` text NOT NULL,
	`composio_user_id` text NOT NULL,
	`connected_account_id` text,
	`auth_config_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `composio_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`connected_account_id` text NOT NULL,
	`composio_user_id` text NOT NULL,
	`auth_config_id` text NOT NULL,
	`toolkit_slug` text DEFAULT 'github' NOT NULL,
	`provider_login` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`connected_by` text NOT NULL,
	`last_synced_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `composio_connections_workspace_account_idx` ON `composio_connections` (`workspace_id`,`connected_account_id`);--> statement-breakpoint
CREATE TABLE `composio_github_repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`full_name` text NOT NULL,
	`default_branch` text NOT NULL,
	`is_private` integer DEFAULT true NOT NULL,
	`html_url` text NOT NULL,
	`selected` integer DEFAULT false NOT NULL,
	`synced_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `composio_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `composio_repositories_connection_repo_idx` ON `composio_github_repositories` (`connection_id`,`repository_id`);
