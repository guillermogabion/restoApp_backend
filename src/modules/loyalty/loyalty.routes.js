// src/modules/loyalty/loyalty.routes.js
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const ctrl = require('./loyalty.controller');
const schema = require('./loyalty.validators');

router.use(authenticate);

router.get('/program',            authorize('OWNER', 'MANAGER'),           ctrl.getProgram);
router.post('/program',           authorize('OWNER'),           validate(schema.upsertProgram), ctrl.upsertProgram);
router.get('/customer/:phone',    authorize('OWNER','MANAGER','CASHIER'),   ctrl.getCustomerByPhone);
router.get('/customers',          authorize('OWNER', 'MANAGER'),           ctrl.listCustomers);
router.get('/customer/:id/history', authorize('OWNER','MANAGER','CASHIER'), ctrl.customerHistory);
router.post('/redeem',            authorize('OWNER','MANAGER','CASHIER'),  validate(schema.redeem), ctrl.previewRedeem);

module.exports = router;
