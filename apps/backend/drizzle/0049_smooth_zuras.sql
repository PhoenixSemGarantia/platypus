ALTER TABLE "agent" RENAME COLUMN "system_prompt" TO "instructions";--> statement-breakpoint
ALTER TABLE "chat" RENAME COLUMN "system_prompt" TO "instructions";