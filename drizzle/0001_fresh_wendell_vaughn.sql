ALTER TABLE `simulation_runs` ADD `scenario_key` text;--> statement-breakpoint
ALTER TABLE `simulation_runs` ADD `scenario_fingerprint` text;--> statement-breakpoint
ALTER TABLE `simulation_runs` ADD `seed` text;--> statement-breakpoint
ALTER TABLE `simulation_runs` ADD `before_error_rate` text;--> statement-breakpoint
ALTER TABLE `simulation_runs` ADD `after_error_rate` text;--> statement-breakpoint
ALTER TABLE `simulation_runs` ADD `before_latency_ms` integer;--> statement-breakpoint
ALTER TABLE `simulation_runs` ADD `after_latency_ms` integer;--> statement-breakpoint
ALTER TABLE `simulation_runs` ADD `before_journey_success` integer;--> statement-breakpoint
ALTER TABLE `simulation_runs` ADD `after_journey_success` integer;--> statement-breakpoint
ALTER TABLE `simulation_runs` ADD `verified_at` text;