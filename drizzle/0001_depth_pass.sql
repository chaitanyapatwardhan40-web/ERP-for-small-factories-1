CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text NOT NULL,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"customer_id" uuid,
	"item_id" uuid NOT NULL,
	"min_qty" numeric(14, 4) DEFAULT 0 NOT NULL,
	"unit_price" numeric(14, 4) NOT NULL,
	"valid_from" date,
	"valid_to" date
);
--> statement-breakpoint
CREATE TABLE "vendor_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"vendor_part_no" text,
	"last_cost" numeric(14, 4) DEFAULT 0 NOT NULL,
	"lead_time_days" integer,
	"min_qty" numeric(14, 4) DEFAULT 0 NOT NULL,
	"preferred" boolean DEFAULT false NOT NULL,
	"last_purchased_at" date
);
--> statement-breakpoint
CREATE TABLE "employee_trainings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"skill" text NOT NULL,
	"trained_at" date NOT NULL,
	"expires_at" date,
	"trainer" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"amount" numeric(14, 4) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_payment_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(14, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"memo" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"next_date" date,
	"last_posted_at" date,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gauge_calibrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"gauge_id" uuid NOT NULL,
	"calibrated_at" date NOT NULL,
	"due_at" date,
	"result" text DEFAULT 'pass' NOT NULL,
	"cert_no" text,
	"performed_by" text,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ALTER COLUMN "item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tax_cert_no" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_limit" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "discount_pct" numeric(7, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "sales_rep" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "ship_via" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "account_no" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "payment_method" text DEFAULT 'check' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "tax_id" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "is_1099" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "ship_via" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "min_order" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "ref_des" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "weight" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "safety_stock" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "min_order_qty" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "shelf_life_days" integer;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN "discount_pct" numeric(7, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "terms" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "discount_pct" numeric(7, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "qty_cancelled" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "discount_pct" numeric(7, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "internal_notes" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "requested_date" date;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "ship_to" jsonb;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "ship_via" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "freight" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "discount_pct" numeric(7, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "terms_days" integer;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "sales_rep" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "hold_reason" text;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "line_type" text DEFAULT 'item' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "vendor_part_no" text;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "qty_cancelled" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "expense_subtype" text;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "terms_days" integer;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "ship_via" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "freight" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "tax" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "ship_to" jsonb;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "internal_notes" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "buyer_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "shift" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "hire_date" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "labor_entries" ADD COLUMN "scrap_reason" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "scheduled_start" date;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "scheduled_end" date;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "scrap_reason" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "packages" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "weight" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "ship_to" jsonb;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "freight_charge" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "unapplied" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "memo" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "kind" text DEFAULT 'invoice' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "credit_of_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "freight" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "terms_days" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "memo" text;--> statement-breakpoint
ALTER TABLE "vendor_bills" ADD COLUMN "freight" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "capas" ADD COLUMN "preventive_action" text;--> statement-breakpoint
ALTER TABLE "capas" ADD COLUMN "effectiveness_check_at" date;--> statement-breakpoint
ALTER TABLE "capas" ADD COLUMN "effective" boolean;--> statement-breakpoint
ALTER TABLE "gauges" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "gauges" ADD COLUMN "owner" text;--> statement-breakpoint
ALTER TABLE "ncrs" ADD COLUMN "root_cause" text;--> statement-breakpoint
ALTER TABLE "ncrs" ADD COLUMN "containment" text;--> statement-breakpoint
ALTER TABLE "ncrs" ADD COLUMN "cost" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ncrs" ADD COLUMN "customer_ref" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "expected_close" date;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lost_reason" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "manufacturer" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_items" ADD CONSTRAINT "vendor_items_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_items" ADD CONSTRAINT "vendor_items_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_trainings" ADD CONSTRAINT "employee_trainings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_trainings" ADD CONSTRAINT "employee_trainings_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment_applications" ADD CONSTRAINT "customer_payment_applications_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment_applications" ADD CONSTRAINT "customer_payment_applications_payment_id_customer_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."customer_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment_applications" ADD CONSTRAINT "customer_payment_applications_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_templates" ADD CONSTRAINT "journal_templates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gauge_calibrations" ADD CONSTRAINT "gauge_calibrations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gauge_calibrations" ADD CONSTRAINT "gauge_calibrations_gauge_id_gauges_id_fk" FOREIGN KEY ("gauge_id") REFERENCES "public"."gauges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_addresses_customer" ON "customer_addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_prices_item" ON "customer_prices" USING btree ("org_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_items_vendor_item" ON "vendor_items" USING btree ("org_id","vendor_id","item_id");--> statement-breakpoint
CREATE INDEX "vendor_items_item" ON "vendor_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "employee_trainings_employee" ON "employee_trainings" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_account_period" ON "budgets" USING btree ("org_id","account_id","year","month");--> statement-breakpoint
CREATE INDEX "cpa_payment" ON "customer_payment_applications" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "cpa_invoice" ON "customer_payment_applications" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "gauge_calibrations_gauge" ON "gauge_calibrations" USING btree ("gauge_id");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;