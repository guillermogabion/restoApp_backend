// src/modules/users/user.routes.js
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const ctrl = require('./user.controller');
const schema = require('./user.validators');

router.use(authenticate);

router.get('/',          authorize('OWNER', 'MANAGER'),  ctrl.list);
router.get('/:id',       authorize('OWNER', 'MANAGER'),  ctrl.getOne);
router.post('/',         authorize('OWNER', 'MANAGER'),  validate(schema.create), ctrl.create);
router.patch('/:id',     authorize('OWNER', 'MANAGER'),  validate(schema.update), ctrl.update);
router.delete('/:id',    authorize('OWNER'),              ctrl.deactivate);
router.patch('/:id/reset-pin',  authorize('OWNER','MANAGER'), validate(schema.resetPin), ctrl.resetPin);

module.exports = router;
