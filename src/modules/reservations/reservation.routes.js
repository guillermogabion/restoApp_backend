// src/modules/reservations/reservation.routes.js
const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const ctrl = require('./reservation.controller');

const allowRoles = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    next();
};

router.use(authenticate);

router.get('/:branchId', allowRoles('OWNER', 'MANAGER', 'CASHIER'), ctrl.listReservations);
router.get('/detail/:id', allowRoles('OWNER', 'MANAGER', 'CASHIER'), ctrl.getReservation);
router.post('/', allowRoles('OWNER', 'MANAGER', 'CASHIER'), ctrl.createReservation);
router.patch('/:id', allowRoles('OWNER', 'MANAGER', 'CASHIER'), ctrl.updateReservation);
router.patch('/:id/status', allowRoles('OWNER', 'MANAGER', 'CASHIER'), ctrl.updateStatus);
router.patch('/:id/pay', allowRoles('OWNER', 'MANAGER', 'CASHIER'), ctrl.markPaid);
router.delete('/:id', allowRoles('OWNER', 'MANAGER'), ctrl.deleteReservation);

module.exports = router;