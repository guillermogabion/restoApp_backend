// src/modules/auth/auth.routes.js
const router = require('express').Router();
const { validate } = require('../../middleware/validate');
const { authenticate } = require('../../middleware/auth');
const ctrl = require('./auth.controller');
const schema = require('./auth.validators');

router.post('/login',         validate(schema.login),   ctrl.login);
router.post('/refresh',       validate(schema.refresh), ctrl.refresh);
router.post('/logout',        authenticate,             ctrl.logout);
router.get('/me',             authenticate,             ctrl.me);
router.post('/pin-login',     validate(schema.pinLogin), ctrl.pinLogin);
router.patch('/me',           authenticate, validate(schema.updateProfile), ctrl.updateProfile);
router.post('/change-password', authenticate, validate(schema.changePassword), ctrl.changePassword);
router.post('/branches', validate(schema.branches), ctrl.getPublicBranches);
module.exports = router;
