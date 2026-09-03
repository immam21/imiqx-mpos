-- OneCounter — optional schema updates
-- Run in the Supabase SQL editor (Dashboard → SQL → New query → Run).
--
-- IMPORTANT: Pricing needs NO schema change.
--   * Price / MRP     -> product_prices.mrp          (already exists)
--   * Offer Sale price-> product_prices.selling_price (already exists)
-- The app already reads/writes both. Billing uses selling_price (offer).
--
-- The one optional improvement below adds a dedicated "place" column for
-- customers. Until you run this, the app stores the customer's place in the
-- existing customers.segment column. After running it, tell me and I'll switch
-- the code to use this dedicated column.

alter table customers add column if not exists place text;
alter table customers add column if not exists full_address text;
alter table customers add column if not exists city text;
alter table customers add column if not exists pincode text;

-- Optional: migrate any place values previously stored in segment.
-- (Safe to skip if you never entered a place before.)
-- update customers set place = segment where place is null and segment is not null;

-- Optional: an index to speed up phone lookups used by POS + customer search.
create index if not exists idx_customers_phone on customers (business_id, phone);

-- Shop and miscellaneous expenses used by the dashboard and reports.
create table if not exists expenses (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	store_id uuid not null references stores(id) on delete cascade,
	expense_date date not null default current_date,
	category text not null,
	description text,
	amount numeric(12,2) not null check (amount > 0),
	payment_mode text,
	created_at timestamptz not null default now()
);

create index if not exists idx_expenses_store_date on expenses (store_id, expense_date desc);

-- Exact transaction timestamps. orders.created_at already records sale time;
-- expense_at records when the expense occurred, independently of entry time.
alter table expenses add column if not exists expense_at timestamptz not null default now();
update expenses set expense_at = created_at where expense_at is null;
create index if not exists idx_expenses_store_expense_at on expenses (store_id, expense_at desc);

-- Delivery details are stored on the order as a snapshot for online fulfillment.
alter table orders add column if not exists delivery_address text;
alter table orders add column if not exists delivery_city text;
alter table orders add column if not exists delivery_pincode text;
create index if not exists idx_orders_store_channel_created on orders (store_id, channel, created_at desc);

-- Attribute every sale and expense to the authenticated staff member.
alter table orders add column if not exists sold_by_user_id uuid references app_users(id) on delete set null;
alter table orders add column if not exists sold_by_name text;
create index if not exists idx_orders_store_staff_date on orders (store_id, sold_by_user_id, created_at desc);

alter table expenses add column if not exists recorded_by_user_id uuid references app_users(id) on delete set null;
alter table expenses add column if not exists recorded_by_name text;
create index if not exists idx_expenses_store_staff_date on expenses (store_id, recorded_by_user_id, expense_date desc);

-- Per-store cash drawer lifecycle for daily opening and closing reconciliation.
create table if not exists cash_sessions (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	store_id uuid not null references stores(id) on delete cascade,
	opening_amount numeric(12,2) not null check (opening_amount >= 0),
	closing_amount numeric(12,2),
	opened_at timestamptz not null default now(),
	closed_at timestamptz,
	opened_by_user_id uuid references app_users(id) on delete set null,
	opened_by_name text,
	closed_by_user_id uuid references app_users(id) on delete set null,
	closed_by_name text,
	status text not null default 'open' check (status in ('open', 'closed'))
);
create unique index if not exists idx_cash_sessions_one_open_per_store on cash_sessions (store_id) where status = 'open';
create index if not exists idx_cash_sessions_store_opened on cash_sessions (store_id, opened_at desc);

-- Audit trail for the automatic two-hour Google Sheets backup.
create table if not exists google_sheets_sync_runs (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	status text not null check (status in ('success', 'error')),
	sales_rows integer not null default 0,
	expense_rows integer not null default 0,
	error_message text,
	completed_at timestamptz not null default now()
);
alter table google_sheets_sync_runs add column if not exists customer_rows integer not null default 0;
create index if not exists idx_google_sheets_sync_runs_business_completed on google_sheets_sync_runs (business_id, completed_at desc);
