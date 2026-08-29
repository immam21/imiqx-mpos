# OneCounter Platform Overview v2

## Vision
Build a unified retail operating platform that combines:
- Fast in-store POS and inventory operations
- Customer-facing eCommerce storefront
- Centralized finance, GST-compliant invoicing, and business controls
- Integrated communication channels (WhatsApp + campaigns)

Reference concept: Zoho Inventory + Zoho Invoice (conceptual benchmark only).

---

## Product Scope

### Core Modules
1. POS and Billing
- Barcode-based checkout, quick search, cart hold/resume
- Split payment: Cash, UPI, Card, Wallet
- Discount types: line-item, bill-level, coupon
- Instant receipt: print, email, WhatsApp

2. Inventory and Procurement
- Multi-warehouse/location stock ledger
- Purchase orders, goods receipt, stock adjustments
- Batch/expiry support for selected SKUs
- Low-stock and dead-stock insights

3. Orders and Fulfillment
- In-store and online order orchestration in one queue
- Status lifecycle: Created -> Paid -> Packed -> Shipped -> Delivered/Returned
- Return, refund, replacement workflows with audit trail

4. Customers and Promotions (Dedicated Tab)
- 360 customer profile: spend, frequency, last order, outstanding balance
- Segmentation: new, loyal, dormant, high-value, geography-based
- Campaign builder for promotions via WhatsApp templates
- Promotion types: % off, fixed discount, combo, loyalty points
- Campaign analytics: delivered, clicked, converted revenue

5. Reports and Reconciliation
- Sales, tax, payment mode, cashier variance, SKU performance
- Daily close report per store and consolidated business report
- Gross margin, aging inventory, and return-rate dashboard

6. Finance, GST, and Business Setup
- GSTIN/business profile management
- HSN/SAC mapping and tax slab rules
- Invoice templates with legal fields and sequential invoice numbering
- GSTR-ready export data format and tax summary reports

---

## UI/UX Blueprint (Scalable and Production-Ready)

### Design Direction
- Clean enterprise retail UX with high information density and fast task completion
- Primary focus on speed at counter; secondary focus on analytics depth
- Layout supports desktop-first operations and mobile-friendly management views

### Information Architecture
- Left vertical navigation:
  - Dashboard
  - POS
  - Orders
  - Inventory
  - Customers
  - Promotions
  - Reports
  - Integrations
  - Settings
- Global top bar:
  - Store selector
  - Universal search (SKU/order/customer)
  - Notifications
  - Quick actions (New Sale, New PO, New Campaign)

### Key Screen Concepts
1. Dashboard
- KPI cards: Revenue today, Orders, AOV, Low-stock count, Collection split
- Trend panel: 7/30-day sales line + payment breakdown
- Alerts lane: Low stock, reconciliation mismatch, failed integrations

2. POS Screen (Counter Optimized)
- Two-column layout:
  - Left: Product search + scan results + quick categories
  - Right: Cart, taxes, discount, payment split, customer attach
- Sticky bottom action bar: Hold, Park, Invoice, Receive Payment
- Keyboard shortcuts for cashier speed

3. Inventory Screen
- Table-first UI with saved filters and bulk actions
- Side drawer edit for stock adjustment with reason codes
- Reorder recommendation panel using moving average demand

4. Customers Tab
- Segment chips + RFM filters (recency, frequency, monetary)
- Customer timeline (orders, messages, support notes)
- One-click "Create Promotion Campaign" from selected segment

5. Promotions Builder
- Step wizard:
  1) Audience
  2) Offer Rules
  3) Channel (WhatsApp / SMS / Email)
  4) Schedule
  5) Approval + Launch
- Pre-send estimated audience and projected cost

6. Reports Screen
- Drill-down from KPI to transaction details
- Export buttons (CSV, PDF, Google Sheets sync)

### Scalability UX Patterns
- Virtualized data grids for 10k+ rows
- Cursor-based pagination for orders and ledger entries
- Lazy-loaded charts and progressive rendering
- Role-based views: Cashier, Manager, Admin, Accountant
- Multi-store switch with persisted context

---

## Technical Architecture

### 1) Frontend Deployment on Vercel
- Host frontend as separate Vercel project (Next.js or static PWA)
- Use edge caching for static assets and images
- Environment-based API URLs for dev/staging/prod

### 2) Separate Backend on Vercel for API Calls
- Independent Vercel project (Node.js/TypeScript)
- REST or GraphQL endpoints:
  - /auth, /pos, /orders, /inventory, /customers, /promotions, /reports, /integrations
- Queue workers for async jobs (campaign sends, sheet sync, webhook retries)
- API versioning (/v1) and structured error contract

### 3) Supabase for Database and Storage
- PostgreSQL for transactional data
- Supabase Storage for invoices, labels, imports
- Row Level Security for tenant/store isolation
- Realtime channels for live stock and order updates

Suggested high-level entities:
- businesses, stores, users, roles
- products, inventory_ledger, suppliers, purchase_orders
- sales, sale_items, payments, refunds
- customers, segments, campaigns, campaign_events
- tax_profiles, invoices, invoice_series
- integrations, webhook_logs, audit_logs

---

## Security: Token Generation and Timeouts

### Authentication and Token Strategy
- Use Supabase Auth for user identity
- Access token: short-lived (10 to 15 min)
- Refresh token: rotated and revocable
- Device/session table for multi-device control

### Timeout and Session Controls
- Idle timeout: 15 min for cashier roles, 30 min for admin roles
- Absolute session timeout: 8 to 12 hours
- Force re-auth for sensitive actions (void, refund > threshold, GST config changes)

### API Security
- Verify JWT on every backend request
- RBAC + tenant scope checks at service layer
- Rate limiting and WAF rules on public APIs
- Webhook signature verification for WhatsApp and payment callbacks
- Full audit logs for financial and inventory changes

---

## Integrations

### 1) Google Sheets Integration
Use cases:
- Daily sales export
- Live inventory snapshot
- Campaign result export

Implementation:
- Google Service Account with scoped sheet access
- Backend cron/job pushes data to selected sheet tabs
- Retry with idempotency key and failure alerting

### 2) WhatsApp API Integration
Use WhatsApp Business Cloud API:
- Transactional messages: order confirmation, receipt, payment alerts
- Promotional campaigns: approved template messages by segment
- Delivery status tracking for analytics dashboard

Compliance controls:
- Opt-in capture and opt-out management
- Template approval workflow before campaign launch

---

## GST and Business Setup Requirements
- Business onboarding form:
  - Legal name
  - GSTIN
  - PAN
  - Address/State code
  - Invoice prefix rules
- Tax engine:
  - IGST vs CGST/SGST auto decision by place of supply
  - HSN-wise tax rate mapping
  - Inclusive/exclusive tax pricing support
- Compliance outputs:
  - GST invoice PDF
  - Tax summary by period
  - GSTR-compatible exports

---

## Suggested Delivery Phases

Phase 1 (Foundation)
- Auth, business/store setup, POS, products, inventory, basic reports

Phase 2 (Commerce + Customer)
- Online store, unified orders, customer tab, segmentation

Phase 3 (Promotions + Integrations)
- WhatsApp campaigns, Google Sheets sync, campaign analytics

Phase 4 (Finance + Scale)
- Advanced GST, reconciliation automation, performance optimization, multi-store controls

---

## Non-Functional Targets
- POS item add latency: under 150ms at p95
- API response target: under 300ms for core reads at p95
- Uptime target: 99.9%+
- Auditability: 100% trace for stock, billing, refund, tax changes

---

## Final Recommendation
Adopt a modular architecture with separate Vercel frontend and backend, Supabase as the data backbone, strict token lifecycle with role-based timeouts, and a customer-led growth layer (Promotions + WhatsApp + Sheets). This provides fast operations today and scales cleanly for multi-store expansion tomorrow.
