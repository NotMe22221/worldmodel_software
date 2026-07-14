ALTER TABLE `workspaces` ADD `workspace_mode` text DEFAULT 'customer' NOT NULL;
--> statement-breakpoint
UPDATE `workspaces`
SET `workspace_mode` = 'sample'
WHERE `id` IN (
  SELECT DISTINCT `workspace_id`
  FROM `projects`
  WHERE `repository` = 'shopstream/demo-store'
    AND `id` LIKE 'proj_checkout_%'
);
