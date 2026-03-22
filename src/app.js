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

// ── Routes ──────────────────────────────────────
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

const app = express();
const httpServer = createServer(app);

// ── Socket.IO ────────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});
setupSocketIO(io);
app.set('io', io);

// ── Security Middleware ──────────────────────────
app.use(helmet());
app.use(cors({ origin: '*' })); // tighten in production
app.use(compression());

// ── Rate Limiting ────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  message: { error: 'Too many requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ── Body Parsing ─────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(process.env.UPLOAD_DIR || './uploads'));

// ── Logging ──────────────────────────────────────
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ── Health Check ─────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ── API Routes ───────────────────────────────────
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

// ── Error Handlers ───────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = { app, httpServer };
