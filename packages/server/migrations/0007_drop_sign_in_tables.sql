-- `users` and `identities`, the tables a sign-in separate from storage would
-- have used. That sign-in was dropped on 2026-09-18 (docs/ARCHITECTURE.md §6,
-- "No sign-in separate from storage"), nothing has read either table since,
-- and 0005 took away the last table that pointed at `users` (skysa-notes#118).
--
-- `identities` first: it has the foreign key to `users`. `IF EXISTS`, so a run
-- that stopped between the two can be run again.
DROP TABLE IF EXISTS `identities`;--> statement-breakpoint
DROP TABLE IF EXISTS `users`;
