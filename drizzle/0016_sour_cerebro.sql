ALTER TABLE `projects` ADD `graph_json` text DEFAULT '{"version":1,"nodes":[],"edges":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `scan_summary` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `scanned_at` text;
--> statement-breakpoint
UPDATE `projects`
SET `status` = 'unverified'
WHERE `source_kind` = 'manual' AND `scanned_at` IS NULL;
