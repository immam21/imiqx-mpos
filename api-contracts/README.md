# OneCounter API Contracts

Contracts for all current `/v1` endpoints used by the PWA.

## Files

- `openapi.v1.yaml`: OpenAPI 3.1 source of truth
- `schemas/requests.json`: Request-body schemas grouped by endpoint
- `schemas/responses.json`: Response schemas grouped by endpoint

## Covered Routes

- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `GET /v1/reports/dashboard`
- `GET /v1/orders`
- `GET /v1/inventory/products`
- `GET /v1/customers`
- `GET /v1/promotions/campaigns`
- `GET /v1/reports/tax-summary`
- `GET /v1/integrations/status`
- `GET /v1/business/setup`
- `POST /v1/pos/sales`
