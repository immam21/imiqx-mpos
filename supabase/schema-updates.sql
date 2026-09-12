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

-- Store the GST basis and split on every sold item for tax audit and reporting.
alter table order_items add column if not exists tax_percent numeric(5,2) not null default 0;
alter table order_items add column if not exists taxable_amount numeric(12,2) not null default 0;
alter table order_items add column if not exists cgst_amount numeric(12,2) not null default 0;
alter table order_items add column if not exists sgst_amount numeric(12,2) not null default 0;
alter table order_items add column if not exists price_includes_gst boolean not null default false;

alter table orders add column if not exists cgst_amount numeric(12,2) not null default 0;
alter table orders add column if not exists sgst_amount numeric(12,2) not null default 0;
alter table orders add column if not exists prices_include_gst boolean not null default false;
alter table orders add column if not exists discount_amount numeric(12,2) not null default 0;
alter table orders add column if not exists manual_discount_amount numeric(12,2) not null default 0;
alter table orders add column if not exists wallet_balance_after numeric(12,2) not null default 0;

-- Ennaval membership and wallet program. A mobile number identifies one member
-- within a business; every wallet movement is retained in the ledger below.
create table if not exists membership_program_settings (
	business_id uuid primary key references businesses(id) on delete cascade,
	minimum_eligible_purchase numeric(12,2) not null default 699,
	regular_first_purchase_reward_percent numeric(5,2) not null default 10,
	regular_repeat_purchase_reward_percent numeric(5,2) not null default 5,
	exclusive_purchase_reward_percent numeric(5,2) not null default 10,
	referral_reward_percent numeric(5,2) not null default 5,
	referred_first_purchase_reward_percent numeric(5,2) not null default 10,
	regular_wallet_redemption_percent numeric(5,2) not null default 20,
	regular_wallet_redemption_max numeric(12,2) not null default 100,
	exclusive_wallet_redemption_max numeric(12,2) not null default 150,
	exclusive_membership_fee numeric(12,2) not null default 199,
	exclusive_joining_credit numeric(12,2) not null default 250,
	regular_wallet_expiry_months integer not null default 6,
	exclusive_wallet_expiry_months integer not null default 12,
	referral_gift_threshold integer not null default 10,
	updated_at timestamptz not null default now()
);

create table if not exists membership_members (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	customer_id uuid references customers(id) on delete set null,
	phone text not null,
	name text,
	tier text not null default 'regular' check (tier in ('regular', 'exclusive')),
	referral_code text not null,
	referred_by_member_id uuid references membership_members(id) on delete set null,
	wallet_balance numeric(12,2) not null default 0 check (wallet_balance >= 0),
	wallet_expires_at timestamptz,
	eligible_purchase_count integer not null default 0,
	successful_referral_count integer not null default 0,
	referral_gift_pending boolean not null default false,
	joined_at timestamptz not null default now(),
	last_purchase_at timestamptz,
	unique (business_id, phone),
	unique (business_id, referral_code)
);

create table if not exists membership_wallet_transactions (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	member_id uuid not null references membership_members(id) on delete cascade,
	order_id uuid references orders(id) on delete set null,
	transaction_type text not null check (transaction_type in ('exclusive_joining_credit', 'purchase_reward', 'referral_reward', 'wallet_redemption', 'expiry_adjustment')),
	amount numeric(12,2) not null,
	balance_after numeric(12,2) not null,
	created_at timestamptz not null default now()
);

create table if not exists membership_referrals (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	referrer_member_id uuid not null references membership_members(id) on delete cascade,
	referred_member_id uuid not null unique references membership_members(id) on delete cascade,
	successful_order_id uuid references orders(id) on delete set null,
	status text not null default 'pending' check (status in ('pending', 'successful')),
	completed_at timestamptz,
	created_at timestamptz not null default now()
);

create index if not exists idx_membership_members_business_phone on membership_members (business_id, phone);
create index if not exists idx_membership_wallet_transactions_member on membership_wallet_transactions (member_id, created_at desc);
create index if not exists idx_membership_referrals_referrer on membership_referrals (referrer_member_id, status);
