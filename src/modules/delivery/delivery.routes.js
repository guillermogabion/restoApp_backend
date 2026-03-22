// src/modules/delivery/delivery.routes.js
const router = require('express').Router();
const { authenticate, authorize, enforceBranch } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const ctrl = require('./delivery.controller');
const schema = require('./delivery.validators');

router.use(authenticate);

// Assign rider to order
router.post('/assign',
  authorize('OWNER', 'MANAGER', 'CASHIER'),
  validate(schema.assign),
  ctrl.assignRider
);

// Update delivery status (rider)
router.patch('/:deliveryId/status',
  authorize('OWNER', 'MANAGER', 'DELIVERY_RIDER'),
  validate(schema.updateStatus),
  ctrl.updateStatus
);

// Active deliveries for a branch
router.get('/active/:branchId',
  authorize('OWNER', 'MANAGER', 'CASHIER'),
  enforceBranch,
  ctrl.activeDeliveries
);

// Rider's own active deliveries
router.get('/my-deliveries',
  authorize('DELIVERY_RIDER'),
  ctrl.myDeliveries
);

// Update rider GPS location
router.post('/location',
  authorize('DELIVERY_RIDER'),
  validate(schema.location),
  ctrl.updateLocation
);

// Delivery zones management
router.get('/zones/:branchId',   authorize('OWNER', 'MANAGER', 'CASHIER'), enforceBranch, ctrl.getZones);
router.post('/zones',            authorize('OWNER', 'MANAGER'), validate(schema.createZone), ctrl.createZone);
router.patch('/zones/:zoneId',   authorize('OWNER', 'MANAGER'), ctrl.updateZone);
router.delete('/zones/:zoneId',  authorize('OWNER', 'MANAGER'), ctrl.deleteZone);

module.exports = router;
