// src/modules/inventory/inventory.routes.js
const router = require('express').Router();
const { authenticate, authorize, enforceBranch } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const ctrl = require('./inventory.controller');
const schema = require('./inventory.validators');

router.use(authenticate);

router.get('/branch/:branchId',
  authorize('OWNER', 'MANAGER'),
  enforceBranch,
  ctrl.list
);

router.post('/',
  authorize('OWNER', 'MANAGER'),
  validate(schema.create),
  ctrl.create
);

router.patch('/:id',
  authorize('OWNER', 'MANAGER'),
  validate(schema.update),
  ctrl.update
);

router.post('/:id/movement',
  authorize('OWNER', 'MANAGER'),
  validate(schema.movement),
  ctrl.addMovement
);

router.get('/:id/movements',
  authorize('OWNER', 'MANAGER'),
  ctrl.getMovements
);

router.get('/low-stock/:branchId',
  authorize('OWNER', 'MANAGER'),
  enforceBranch,
  ctrl.getLowStock
);

module.exports = router;
