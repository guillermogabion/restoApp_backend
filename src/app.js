// src/app.js
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');

const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { setupSocketIO } = require('./utils/socket');

// ── Initialize App First ──────────────────────────
const app = express();
const httpServer = createServer(app);

// ── Socket.IO (Conditional for Vercel) ────────────
if (process.env.VERCEL !== '1') {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
  });
  setupSocketIO(io);
  app.set('io', io);
} else {
  app.set('io', { emit: () => { } }); // Mock for Vercel
}

// ── Security & Global Middleware ──────────────────
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Logging ──────────────────────────────────────
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ── Status Routes (Must be BEFORE API Routes) ─────
app.get('/', (req, res) => {
  res.send("RestoApp API is running...");
});

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ── API Routes ───────────────────────────────────
const authRoutes = require('./modules/auth/auth.routes');
const tenantRoutes = require('./modules/tenants/tenant.routes');
const branchRoutes = require('./modules/branches/branch.routes');
const userRoutes = require('./modules/users/user.routes');
const menuRoutes = require('./modules/menu/menu.routes');
const orderRoutes = require('./modules/orders/order.routes');
const kitchenRoutes = require('./modules/kitchen/kitchen.routes');
const inventoryRoutes = require('./modules/inventory/inventory.routes');
const salesRoutes = require('./modules/sales/sales.routes');
const deliveryRoutes = require('./modules/delivery/delivery.routes');
const loyaltyRoutes = require('./modules/loyalty/loyalty.routes');
const syncRoutes = require('./modules/sync/sync.routes');
const adminRoutes = require('./modules/admin/admin.routes');

app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/users', userRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/kitchen', kitchenRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api', adminRoutes);

// ── Error Handlers (Must be LAST) ────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = { app, httpServer };