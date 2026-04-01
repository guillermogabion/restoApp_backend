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

// GET all reservations for user's branch (no branchId required)
router.get('/', allowRoles('OWNER', 'MANAGER', 'CASHIER'), ctrl.listReservationsForBranch);

// GET all reservations for specified branch
router.get('/:branchId', allowRoles('OWNER', 'MANAGER', 'CASHIER'), ctrl.listReservations);

// GET specific reservation
router.get('/detail/:id', allowRoles('OWNER', 'MANAGER', 'CASHIER'), ctrl.getReservation);

// CREATE new reservation
router.post('/', allowRoles('OWNER', 'MANAGER', 'CASHIER'), ctrl.createReservation);

// UPDATE reservation
router.patch('/:id', allowRoles('OWNER', 'MANAGER', 'CASHIER'), ctrl.updateReservation);

// UPDATE status
router.patch('/:id/status', allowRoles('OWNER', 'MANAGER', 'CASHIER'), ctrl.updateStatus);

// MARK as paid
router.patch('/:id/pay', allowRoles('OWNER', 'MANAGER', 'CASHIER'), ctrl.markPaid);

// DELETE reservation
router.delete('/:id', allowRoles('OWNER', 'MANAGER'), ctrl.deleteReservation);

module.exports = router;