CREATE TABLE "cash_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"date" date NOT NULL,
	"expected_amount" bigint NOT NULL,
	"counted_amount" bigint NOT NULL,
	"difference" bigint NOT NULL,
	"note" text,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clubs" ALTER COLUMN "settings" SET DEFAULT '{"capacityPolicy":"warn","calendarProration":"daily","sessionPackCountsAbsent":true,"sessionPackCountsExcused":false,"maxFreezeDays":30,"maxFreezesPerSubscription":2,"autoRenew":true,"debtorPolicy":"warn","attendanceNotify":"absent_only"}'::jsonb;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "receipt_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "payroll_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_closings_branch_date_uq" ON "cash_closings" USING btree ("branch_id","date");