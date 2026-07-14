CREATE TABLE `billing_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`processed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `github_installations` (
	`installation_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`account_login` text NOT NULL,
	`account_type` text NOT NULL,
	`repository_selection` text NOT NULL,
	`permissions_json` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`connected_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `github_repositories` (
	`repository_id` text PRIMARY KEY NOT NULL,
	`installation_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`full_name` text NOT NULL,
	`default_branch` text NOT NULL,
	`is_private` integer DEFAULT true NOT NULL,
	`selected` integer DEFAULT false NOT NULL,
	`synced_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`installation_id`) REFERENCES `github_installations`(`installation_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `integration_states` (
	`token` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`purpose` text NOT NULL,
	`installation_id` text,
	`created_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`status` text DEFAULT 'trialing' NOT NULL,
	`plan` text DEFAULT 'trial' NOT NULL,
	`current_period_end` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
