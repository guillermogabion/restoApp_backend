// src/modules/tenants/tenant.routes.js
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const ctrl = require('./tenant.controller');
const schema = require('./tenant.validators');

// Public: register a new tenant (onboarding)
router.post('/register', validate(schema.register), ctrl.register);

router.use(authenticate);
router.get('/me',       ctrl.getMyTenant);
router.patch('/me',     authorize('OWNER'), validate(schema.update), ctrl.updateTenant);

module.exports = router;
