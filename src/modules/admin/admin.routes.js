// src/modules/admin/admin.routes.js
const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const ctrl = require('./admin.controller');

const allowRoles = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    next();
};

router.use(authenticate);

router.get('/branches', allowRoles('OWNER', 'MANAGER'), ctrl.listBranches);
router.post('/branches', allowRoles('OWNER'), ctrl.createBranch);
router.patch('/branches/:id', allowRoles('OWNER', 'MANAGER'), ctrl.updateBranch);

router.get('/users', allowRoles('OWNER', 'MANAGER'), ctrl.listUsers);
router.post('/users', allowRoles('OWNER', 'MANAGER'), ctrl.createUser);
router.patch('/users/:id', allowRoles('OWNER', 'MANAGER'), ctrl.updateUser);

module.exports = router;