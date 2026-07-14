ALTER TABLE `simulation_runs` ADD `evidence_kind` text DEFAULT 'modeled' NOT NULL;
--> statement-breakpoint
UPDATE `simulation_runs`
SET `evidence_kind` = 'sample_fixture'
WHERE `project_id` IN (
  SELECT `id` FROM `projects` WHERE `source_kind` = 'sample'
);
