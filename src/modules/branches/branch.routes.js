// src/modules/branches/branch.routes.js
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const ctrl = require('./branch.controller');
const schema = require('./branch.validators');

router.use(authenticate);

router.get('/',        authorize('OWNER','MANAGER'),  ctrl.list);
router.get('/:id',     authorize('OWNER','MANAGER'),  ctrl.getOne);
router.post('/',       authorize('OWNER'),  validate(schema.create), ctrl.create);
router.patch('/:id',   authorize('OWNER'),  validate(schema.update), ctrl.update);
router.delete('/:id',  authorize('OWNER'),  ctrl.deactivate);

module.exports = router;
