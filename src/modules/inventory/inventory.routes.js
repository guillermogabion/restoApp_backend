// src/modules/inventory/inventory.routes.js
const router = require('express').Router();
const { authenticate, authorize, enforceBranch } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const ctrl = require('./inventory.controller');
const schema = require('./inventory.validators');

router.use(authenticate);

// 1. Specific/Static paths FIRST
router.get('/low-stock/:branchId',
  authorize('OWNER', 'MANAGER'),
  enforceBranch,
  ctrl.getLowStock
);

router.get('/dashboard/:branchId',
  authorize('OWNER', 'MANAGER', 'CASHIER'),
  enforceBranch,
  ctrl.getDashboard
);

router.get('/realtime/:branchId',
  authorize('OWNER', 'MANAGER', 'CASHIER'),
  enforceBranch,
  ctrl.getRealTimeStatus
);

// 2. Movement routes (contain static 'movements' or 'movement' words)
router.post('/:id/movement',
  authorize('OWNER', 'MANAGER'),
  validate(schema.movement),
  ctrl.addMovement
);

router.get('/:id/movements',
  authorize('OWNER', 'MANAGER'),
  ctrl.getMovements
);

// 3. Generic Parameters LAST
router.get('/:branchId', // This acts as the "fallback" for a GET with an ID
  authorize('OWNER', 'MANAGER'),
  enforceBranch,
  ctrl.list
);

router.patch('/:id',
  authorize('OWNER', 'MANAGER'),
  validate(schema.update),
  ctrl.update
);

// 4. Base POST (already correct)
router.post('/',
  authorize('OWNER', 'MANAGER'),
  validate(schema.create),
  ctrl.create
);

module.exports = router;
