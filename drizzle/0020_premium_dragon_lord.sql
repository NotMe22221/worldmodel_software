ALTER TABLE `subscriptions` ADD `stripe_event_created` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `stripe_event_priority` integer DEFAULT 0 NOT NULL;