ALTER TABLE `simulation_runs` ADD `environment_id` text;--> statement-breakpoint
ALTER TABLE `simulation_runs` ADD `journey_runner` text;--> statement-breakpoint
ALTER TABLE `simulation_runs` ADD `environment_destroyed_at` text;--> statement-breakpoint
ALTER TABLE `simulation_runs` ADD `before_service_health` integer;--> statement-breakpoint
ALTER TABLE `simulation_runs` ADD `after_service_health` integer;--> statement-breakpoint
ALTER TABLE `simulation_runs` ADD `attestation_json` text;