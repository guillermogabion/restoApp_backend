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

// 1. INITIALIZE APP FIRST (Fixes the ReferenceError)
const app = express();
const httpServer = createServer(app);

// 2. SOCKET.IO (Conditional for Vercel)
// Vercel Serverless doesn't support WebSockets; this prevents the 500 crash.
if (process.env.VERCEL !== '1') {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
  });
  setupSocketIO(io);
  app.set('io', io);
} else {
  // Mock 'io' so your routes calling app.get('io') don't break
  app.set('io', { emit: () => { } });
}

// 3. GLOBAL MIDDLEWARE
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 4. LOGGING
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// 5. STATUS ROUTES (Moved up so they work correctly)
app.get('/', (req, res) => {
  res.send("RestoApp API is running...");
});

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// 6. API ROUTES
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
const reservationRoutes = require('./modules/reservations/reservation.routes');

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
app.use('/api/reservations', reservationRoutes);

// 7. ERROR HANDLERS (Must be last)
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = { app, httpServer };