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
