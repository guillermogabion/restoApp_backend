// src/modules/orders/order.routes.js
const router = require('express').Router();
const { authenticate, authorize, enforceBranch } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const ctrl = require('./order.controller');
const schema = require('./order.validators');

// All order routes require authentication
router.use(authenticate);

// Create order (Cashier, Waiter, Owner, Manager)
router.post('/',
  authorize('OWNER', 'MANAGER', 'CASHIER', 'WAITER'),
  enforceBranch,
  validate(schema.create),
  ctrl.createOrder
);

// Validate order inventory availability
router.post('/validate-inventory',
  authorize('OWNER', 'MANAGER', 'CASHIER', 'WAITER'),
  enforceBranch,
  validate(schema.validateInventory),
  ctrl.validateOrderInventory
);

// QR customer self-order (public - no auth needed, uses QR token)
router.post('/qr',
  validate(schema.qrOrder),
  ctrl.qrOrder
);

// List orders for a branch
router.get('/branch/:branchId',
  authorize('OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'),
  enforceBranch,
  validate(schema.listQuery),
  ctrl.listOrders
);

// Get single order
router.get('/:orderId',
  ctrl.getOrder
);

// Update order status
router.patch('/:orderId/status',
  authorize('OWNER', 'MANAGER', 'CASHIER', 'KITCHEN', 'WAITER'),
  validate(schema.updateStatus),
  ctrl.updateStatus
);

// Process payment
router.post('/:orderId/pay',
  authorize('OWNER', 'MANAGER', 'CASHIER'),
  validate(schema.pay),
  ctrl.processPayment
);

// Cancel order
router.post('/:orderId/cancel',
  authorize('OWNER', 'MANAGER', 'CASHIER'),
  ctrl.cancelOrder
);

// Order item status update (kitchen)
router.patch('/:orderId/items/:itemId/status',
  authorize('OWNER', 'MANAGER', 'KITCHEN'),
  validate(schema.updateItemStatus),
  ctrl.updateItemStatus
);

module.exports = router;
