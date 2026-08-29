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
