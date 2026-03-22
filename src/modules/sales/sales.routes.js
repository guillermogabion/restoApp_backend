// src/modules/sales/sales.routes.js
const router = require('express').Router();
const { authenticate, authorize, enforceBranch } = require('../../middleware/auth');
const ctrl = require('./sales.controller');

router.use(authenticate);

// Daily sales report
router.get('/daily/:branchId',
  authorize('OWNER', 'MANAGER', 'CASHIER'),
  enforceBranch,
  ctrl.dailySales
);

// Range report
router.get('/range/:branchId',
  authorize('OWNER', 'MANAGER'),
  enforceBranch,
  ctrl.salesRange
);

// Owner dashboard - all branches summary
router.get('/dashboard',
  authorize('OWNER', 'MANAGER'),
  ctrl.ownerDashboard
);

// Top selling items
router.get('/top-items/:branchId',
  authorize('OWNER', 'MANAGER'),
  enforceBranch,
  ctrl.topItems
);

// Hourly breakdown
router.get('/hourly/:branchId',
  authorize('OWNER', 'MANAGER'),
  enforceBranch,
  ctrl.hourlySales
);

module.exports = router;
