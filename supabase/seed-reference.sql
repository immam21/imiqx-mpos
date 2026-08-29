-- Minimal reference data required for the app to resolve store/business codes.
-- Transactional tables (orders, sales, inventory, customers, ...) stay EMPTY,
-- so all dashboards read live/zero values from the real database.
-- Safe to run multiple times.

insert into businesses (code, legal_name, gstin, pan, invoice_prefix, timezone, is_active)
values ('business-main', 'OneCounter Retail Pvt Ltd', null, null, 'INV/', 'Asia/Kolkata', true)
on conflict (code) do nothing;

insert into stores (business_id, code, name, store_type, city, state, is_active)
select b.id, s.code, s.name, s.store_type, s.city, s.state, true
from businesses b
cross join (values
  ('store-main',   'Coimbatore Main',     'retail',  'Coimbatore', 'Tamil Nadu'),
  ('store-north',  'Coimbatore North',    'retail',  'Coimbatore', 'Tamil Nadu'),
  ('store-online', 'Online Fulfillment',  'online',  'Coimbatore', 'Tamil Nadu')
) as s(code, name, store_type, city, state)
where b.code = 'business-main'
on conflict do nothing;
