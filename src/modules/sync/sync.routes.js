// src/modules/sync/sync.routes.js
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const ctrl = require('./sync.controller');
const schema = require('./sync.validators');

router.use(authenticate);

// Push a batch of offline operations to the server
router.post('/push',
  authorize('OWNER', 'MANAGER', 'CASHIER', 'WAITER'),
  validate(schema.push),
  ctrl.push
);

// Get server state delta since last sync
router.get('/pull',
  ctrl.pull
);

// Check sync status of a batch
router.get('/status/:batchId',
  ctrl.batchStatus
);

module.exports = router;
