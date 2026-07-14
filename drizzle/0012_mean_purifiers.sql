ALTER TABLE `projects` ADD `source_kind` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `repository_verified` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE `projects`
SET `source_kind` = 'sample', `repository_verified` = 0
WHERE `repository` = 'shopstream/demo-store'
  AND `id` LIKE 'proj_checkout_%';
--> statement-breakpoint
UPDATE `projects`
SET `source_kind` = 'github', `repository_verified` = 1
WHERE EXISTS (
  SELECT 1
  FROM `github_repositories` gr
  WHERE gr.`workspace_id` = `projects`.`workspace_id`
    AND lower(gr.`full_name`) = lower(`projects`.`repository`)
    AND gr.`selected` = 1
);
