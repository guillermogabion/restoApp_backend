// src/modules/kitchen/kitchen.routes.js
const router = require('express').Router();
const { authenticate, authorize, enforceBranch } = require('../../middleware/auth');
const ctrl = require('./kitchen.controller');

router.use(authenticate);

// Kitchen Display System - get all active orders for a branch
router.get('/display/:branchId',
  authorize('OWNER', 'MANAGER', 'KITCHEN', 'WAITER'),
  enforceBranch,
  ctrl.getKitchenDisplay
);

// Bump an order item (mark as done from KDS)
router.patch('/bump/:orderId/:itemId',
  authorize('OWNER', 'MANAGER', 'KITCHEN'),
  ctrl.bumpItem
);

// Bump entire order
router.patch('/bump-order/:orderId',
  authorize('OWNER', 'MANAGER', 'KITCHEN'),
  ctrl.bumpOrder
);

module.exports = router;
