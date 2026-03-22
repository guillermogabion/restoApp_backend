# 🍽️ Restaurant Management Backend

> Node.js · Express · Prisma ORM · PostgreSQL · Socket.IO · Redis

Multi-tenant, multi-branch restaurant management system with offline-first sync, real-time kitchen display, and anti-tampering enforcement.

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill environment variables
cp .env.example .env

# 3. Generate Prisma client
npm run db:generate

# 4. Run migrations
npm run db:migrate

# 5. Seed demo data
npm run db:seed

# 6. Start dev server
npm run dev
```

---

## 📁 Project Structure

```
src/
├── app.js                     # Express app + Socket.IO setup
├── server.js                  # Entry point
├── config/
│   └── db.js                  # Prisma client
├── middleware/
│   ├── auth.js                # JWT verify · tenant/branch enforce · RBAC
│   ├── validate.js            # Joi schema middleware
│   ├── audit.js               # Audit log middleware
│   └── errorHandler.js        # Global error handler + AppError class
├── modules/
│   ├── auth/                  # Login · Refresh · PIN login · Logout · /me
│   ├── tenants/               # Register tenant · Get/Update tenant
│   ├── branches/              # CRUD branches
│   ├── users/                 # CRUD users · Reset PIN
│   ├── menu/                  # Categories · Items · Variants · QR tables
│   ├── orders/                # Create · QR orders · Status · Payment · Cancel
│   ├── kitchen/               # KDS display · Bump item · Bump order
│   ├── inventory/             # Stock CRUD · Movements · Low-stock alerts
│   ├── sales/                 # Daily · Range · Dashboard · Top items · Hourly
│   ├── delivery/              # Assign rider · Track · Zones · GPS updates
│   ├── loyalty/               # Program config · Customer lookup · Redeem preview
│   └── sync/                  # Offline push · Pull delta · HMAC verification
├── utils/
│   ├── jwt.js                 # Sign/verify access + refresh tokens
│   ├── pricing.js             # Server-authoritative price computation
│   ├── socket.js              # Socket.IO rooms + emit helpers
│   ├── helpers.js             # Order number generator
│   └── logger.js              # Winston logger
└── jobs/
    └── cron.js                # Daily sales snapshot · Token cleanup · Sync cleanup

prisma/
├── schema.prisma              # Full database schema
└── seed.js                    # Demo data seed
```

---

## 🔐 Authentication

All protected routes require:
```
Authorization: Bearer <accessToken>
```

### POST /api/auth/login
```json
{
  "email": "owner@demo.com",
  "password": "Password123!",
  "tenantSlug": "demo-restaurant"
}
```

### POST /api/auth/pin-login
```json
{
  "pin": "4444",
  "branchId": "<uuid>",
  "tenantSlug": "demo-restaurant"
}
```

### POST /api/auth/refresh
```json
{ "refreshToken": "<token>" }
```

---

## 👥 User Roles & Permissions

| Role            | Orders | Kitchen | Inventory | Sales | Users | Config |
|-----------------|:------:|:-------:|:---------:|:-----:|:-----:|:------:|
| OWNER           | ✅     | ✅      | ✅        | ✅    | ✅    | ✅     |
| MANAGER         | ✅     | ✅      | ✅        | ✅    | ✅*   | ✅     |
| CASHIER         | ✅     | ❌      | ❌        | ✅*   | ❌    | ❌     |
| KITCHEN         | view   | ✅      | ❌        | ❌    | ❌    | ❌     |
| WAITER          | ✅*    | ❌      | ❌        | ❌    | ❌    | ❌     |
| DELIVERY_RIDER  | own    | ❌      | ❌        | ❌    | ❌    | ❌     |

`✅*` = limited scope. Managers cannot create/promote OWNER or MANAGER accounts.

---

## 📦 Core API Routes

### 🏢 Tenants
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/tenants/register | Register new tenant + owner + branch |
| GET | /api/tenants/me | Get current tenant info |
| PATCH | /api/tenants/me | Update tenant (OWNER only) |

### 🏪 Branches
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/branches | List all branches |
| POST | /api/branches | Create branch |
| PATCH | /api/branches/:id | Update branch |
| DELETE | /api/branches/:id | Deactivate branch |

### 👤 Users
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/users | List users |
| POST | /api/users | Create user |
| PATCH | /api/users/:id | Update user |
| DELETE | /api/users/:id | Deactivate user |
| PATCH | /api/users/:id/reset-pin | Reset user PIN |

### 🍽️ Menu
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/menu/public/:slug/:branchId | Public menu for QR customers |
| GET | /api/menu/items | List menu items |
| POST | /api/menu/items | Create item |
| PATCH | /api/menu/items/:id | Update item |
| DELETE | /api/menu/items/:id | Archive item |
| PATCH | /api/menu/items/:id/availability | Toggle availability |
| POST | /api/menu/qr/table | Generate QR for table |
| GET | /api/menu/qr/tables/:branchId | List tables + QR codes |

### 🛒 Orders
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/orders | Create order (staff) |
| POST | /api/orders/qr | Customer self-order via QR |
| GET | /api/orders/branch/:branchId | List orders |
| GET | /api/orders/:orderId | Get order detail |
| PATCH | /api/orders/:orderId/status | Update order status |
| POST | /api/orders/:orderId/pay | Process payment |
| POST | /api/orders/:orderId/cancel | Cancel order |
| PATCH | /api/orders/:orderId/items/:itemId/status | Update item status |

**Order Status Flow:**
```
PENDING → CONFIRMED → PREPARING → READY → SERVED → COMPLETED
                                              ↘ CANCELLED (any stage)
```

### 🖥️ Kitchen Display (KDS)
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/kitchen/display/:branchId | Active orders for KDS |
| PATCH | /api/kitchen/bump/:orderId/:itemId | Bump single item |
| PATCH | /api/kitchen/bump-order/:orderId | Bump entire order |

### 📦 Inventory
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/inventory/branch/:branchId | List inventory |
| POST | /api/inventory | Create item |
| PATCH | /api/inventory/:id | Update item |
| POST | /api/inventory/:id/movement | Add IN/OUT/ADJUSTMENT/WASTE |
| GET | /api/inventory/:id/movements | Movement history |
| GET | /api/inventory/low-stock/:branchId | Low stock alerts |

### 💰 Sales & Dashboard
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/sales/daily/:branchId?date=YYYY-MM-DD | Daily sales |
| GET | /api/sales/range/:branchId?from=&to= | Date range report |
| GET | /api/sales/dashboard | Owner multi-branch dashboard |
| GET | /api/sales/top-items/:branchId | Top selling items |
| GET | /api/sales/hourly/:branchId?date= | Hourly breakdown |

### 🛵 Delivery
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/delivery/assign | Assign rider to order |
| PATCH | /api/delivery/:id/status | Update delivery status |
| GET | /api/delivery/active/:branchId | Active deliveries |
| GET | /api/delivery/my-deliveries | Rider's own deliveries |
| POST | /api/delivery/location | Update GPS location |
| GET/POST/PATCH/DELETE | /api/delivery/zones | Manage delivery zones |

### 🎁 Loyalty
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | /api/loyalty/program | Get or upsert loyalty program |
| GET | /api/loyalty/customer/:phone | Lookup customer by phone |
| GET | /api/loyalty/customers | List all customers |
| GET | /api/loyalty/customer/:id/history | Customer tx history |
| POST | /api/loyalty/redeem | Preview points redemption |

### 🔄 Offline Sync
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/sync/push | Push offline operations batch |
| GET | /api/sync/pull?since=ISO | Pull server delta |
| GET | /api/sync/status/:batchId | Check batch status |

---

## 🔒 Anti-Tampering Strategy

### 1. Server-Authoritative Pricing
Client-submitted prices are **completely ignored**. Every order's `unitPrice`, `subtotal`, and `total` is **recomputed server-side** from the database.

### 2. HMAC Offline Sync Verification
Before a device can push offline operations, it must sign the payload:
```javascript
// Flutter client must compute:
const hmac = HmacSha256(
  jsonEncode({ batchId, deviceId, operations }),
  SYNC_HMAC_SECRET  // shared secret, distributed securely at device enrollment
);
```
Server rejects the batch if HMAC doesn't match. All rejections are logged to `SyncQueue` with reason.

### 3. Idempotent Sync (Dedup)
Each offline operation includes a `clientOrderId`. Server deduplicates — if same `clientOrderId` + `branchId` arrives twice, the second is returned as-is without re-processing.

### 4. Role-Based Status Transitions
Kitchen staff can only move orders to PREPARING/READY. Waiters can only SERVE. Cashiers handle CONFIRMED/COMPLETED/CANCELLED. No role can skip steps arbitrarily.

### 5. Tenant + Branch Isolation
Every DB query is scoped by `tenantId` from JWT — not from request body. Branch access is validated per-user role.

---

## ⚡ Real-Time Events (Socket.IO)

Connect with: `{ auth: { token: "<accessToken>" } }`

| Event | Direction | Payload |
|-------|-----------|---------|
| `order:new` | Server → Kitchen | `{ orderId, orderNumber, items, orderType }` |
| `order:status` | Server → Branch | `{ orderId, status, orderNumber }` |
| `order:paid` | Server → Branch | `{ orderId, orderNumber, total }` |
| `order:cancelled` | Server → Branch | `{ orderId, orderNumber, reason }` |
| `order:bumped` | Server → Kitchen | `{ orderId }` |
| `inventory:low_stock` | Server → Branch | `{ id, name, quantity, lowStockAt }` |
| `delivery:assigned` | Server → Rider | `{ deliveryId, orderId, address }` |
| `delivery:status` | Server → Branch | `{ deliveryId, orderId, status }` |
| `rider:location` | Rider → Server | `{ lat, lng }` |
| `rider:location:update` | Server → Branch | `{ riderId, deliveryId, lat, lng }` |

---

## 🌱 Demo Credentials

After running `npm run db:seed`:

| Role | Email | Password | PIN |
|------|-------|----------|-----|
| Owner | owner@demo.com | Password123! | 1111 |
| Manager | manager@demo.com | Password123! | 2222 |
| Cashier | cashier@demo.com | Password123! | 3333 |
| Kitchen | kitchen@demo.com | Password123! | 4444 |
| Waiter | waiter@demo.com | Password123! | 5555 |
| Rider | rider@demo.com | Password123! | 6666 |

**Tenant Slug:** `demo-restaurant`

---

## 🐳 Docker (Optional)

```yaml
# docker-compose.yml
version: '3.8'
services:
  api:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    depends_on: [db, redis]

  db:
    image: postgres:16
    environment:
      POSTGRES_DB: restaurant_db
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    volumes: [pgdata:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine

volumes:
  pgdata:
```

---

## ⚙️ Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Access token signing secret |
| `JWT_REFRESH_SECRET` | Refresh token signing secret |
| `JWT_EXPIRES_IN` | Access token TTL (default: 15m) |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL (default: 7d) |
| `SYNC_HMAC_SECRET` | Shared secret for offline sync HMAC |
| `REDIS_URL` | Redis connection URL |
| `QR_BASE_URL` | Base URL for QR code deep links |
| `PORT` | Server port (default: 3000) |
