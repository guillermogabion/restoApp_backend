// src/modules/reservations/reservation.controller.js
const { prisma } = require('../../config/db');
const { AppError } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');

// ─── List Reservations ────────────────────────────────────────────────────────
const listReservations = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const { status, type, date, from, to } = req.query;

        const where = { branchId, tenantId: req.user.tenantId };
        if (status) where.status = status;
        if (type) where.type = type;

        if (date) {
            const start = new Date(date); start.setHours(0, 0, 0, 0);
            const end = new Date(date); end.setHours(23, 59, 59, 999);
            where.date = { gte: start, lte: end };
        } else if (from || to) {
            where.date = {};
            if (from) where.date.gte = new Date(from);
            if (to) where.date.lte = new Date(to);
        }

        const reservations = await prisma.reservation.findMany({
            where,
            include: {
                items: { 
                    include: { menuItem: { select: { name: true, imageUrl: true, basePrice: true } } } 
                },
                table: { select: { tableNumber: true } },
            },
            orderBy: { date: 'asc' },
        });

        logger.info(`Listed ${reservations.length} reservations for branch ${branchId}`);
        res.json({ success: true, data: reservations });
    } catch (err) { next(err); }
};

// ─── Get Single Reservation ───────────────────────────────────────────────────
const getReservation = async (req, res, next) => {
    try {
        const reservation = await prisma.reservation.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
            include: {
                items: { include: { menuItem: { select: { name: true, imageUrl: true, basePrice: true } } } },
                table: true,
            },
        });
        if (!reservation) throw new AppError('Reservation not found', 404);
        res.json({ success: true, data: reservation });
    } catch (err) { next(err); }
};

// ─── Create Reservation ───────────────────────────────────────────────────────
const createReservation = async (req, res, next) => {
    try {
        const { tenantId, branchId } = req.user;
        const {
            type = 'TABLE',
            customerName, customerPhone, customerEmail,
            guestCount, date, startTime, endTime,
            tableId, notes, venue,
            depositAmount = 0,
            items = [],
        } = req.body;

        // Validate table if TABLE type
        if (type === 'TABLE' && tableId) {
            const table = await prisma.table.findFirst({
                where: { id: tableId, branchId, isActive: true },
            });
            if (!table) throw new AppError('Table not found', 404);
        }

        // Build reservation items for CATERING
        let computedItems = [];
        let totalAmount = 0;

        if (items && Array.isArray(items) && items.length > 0) {
            // Validate menu items exist
            const menuItemIds = items.map((i) => i.menuItemId);
            const menuItems = await prisma.menuItem.findMany({
                where: { id: { in: menuItemIds }, tenantId, isAvailable: true },
            });

            if (menuItems.length !== menuItemIds.length) {
                throw new AppError('One or more menu items not found or unavailable', 404);
            }

            computedItems = items.map((i) => {
                const mi = menuItems.find((m) => m.id === i.menuItemId);
                if (!mi) throw new AppError(`Menu item not found: ${i.menuItemId}`, 404);
                
                const quantity = parseInt(i.quantity) || 1;
                const unitPrice = parseFloat(mi.basePrice) || 0;
                const subtotal = unitPrice * quantity;
                totalAmount += subtotal;
                
                return {
                    menuItemId: mi.id,
                    name: mi.name,
                    quantity,
                    unitPrice,
                    subtotal,
                    notes: i.notes || null,
                };
            });
        }

        // Create the reservation with items
        const reservation = await prisma.reservation.create({
            data: {
                tenantId, branchId, type,
                customerName, customerPhone,
                customerEmail: customerEmail || null,
                guestCount: guestCount || 1,
                date: new Date(date),
                startTime,
                endTime: endTime || null,
                tableId: tableId || null,
                notes: notes || null,
                venue: venue || null,
                totalAmount,
                depositAmount: parseFloat(depositAmount),
                // Properly create nested items
                ...(computedItems.length > 0 && {
                    items: { 
                        create: computedItems.map(item => ({
                            menuItemId: item.menuItemId,
                            name: item.name,
                            quantity: item.quantity,
                            unitPrice: item.unitPrice,
                            subtotal: item.subtotal,
                            notes: item.notes || null,
                        }))
                    }
                }),
            },
            include: {
                items: { include: { menuItem: { select: { name: true, imageUrl: true, basePrice: true } } } },
                table: { select: { tableNumber: true } },
            },
        });

        logger.info(`Reservation created: ${reservation.id} with ${computedItems.length} items`);
        res.status(201).json({ 
            success: true, 
            data: {
                ...reservation,
                items: reservation.items || []
            }
        });
    } catch (err) { next(err); }
};

// ─── Update Reservation ───────────────────────────────────────────────────────
const updateReservation = async (req, res, next) => {
    try {
        const reservation = await prisma.reservation.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!reservation) throw new AppError('Reservation not found', 404);

        const {
            customerName, customerPhone, customerEmail,
            guestCount, date, startTime, endTime,
            tableId, notes, venue, depositAmount,
            items,
        } = req.body;

        const data = {};
        if (customerName !== undefined) data.customerName = customerName;
        if (customerPhone !== undefined) data.customerPhone = customerPhone;
        if (customerEmail !== undefined) data.customerEmail = customerEmail;
        if (guestCount !== undefined) data.guestCount = guestCount;
        if (date !== undefined) data.date = new Date(date);
        if (startTime !== undefined) data.startTime = startTime;
        if (endTime !== undefined) data.endTime = endTime;
        if (tableId !== undefined) data.tableId = tableId;
        if (notes !== undefined) data.notes = notes;
        if (venue !== undefined) data.venue = venue;
        if (depositAmount !== undefined) data.depositAmount = parseFloat(depositAmount);

        // Replace items if provided
        if (items !== undefined && Array.isArray(items)) {
            if (items.length > 0) {
                const menuItemIds = items.map((i) => i.menuItemId);
                const menuItems = await prisma.menuItem.findMany({
                    where: { id: { in: menuItemIds }, tenantId: req.user.tenantId },
                });

                if (menuItems.length !== menuItemIds.length) {
                    throw new AppError('One or more menu items not found', 404);
                }

                let totalAmount = 0;
                const computedItems = items.map((i) => {
                    const mi = menuItems.find((m) => m.id === i.menuItemId);
                    if (!mi) throw new AppError(`Menu item not found: ${i.menuItemId}`, 404);
                    
                    const quantity = parseInt(i.quantity) || 1;
                    const unitPrice = parseFloat(mi.basePrice) || 0;
                    const subtotal = unitPrice * quantity;
                    totalAmount += subtotal;
                    
                    return { 
                        menuItemId: mi.id, 
                        name: mi.name, 
                        quantity, 
                        unitPrice, 
                        subtotal, 
                        notes: i.notes || null 
                    };
                });
                data.totalAmount = totalAmount;
                data.items = { deleteMany: {}, create: computedItems };
            } else {
                // If empty array, delete all items
                data.items = { deleteMany: {} };
                data.totalAmount = 0;
            }
        }

        const updated = await prisma.reservation.update({
            where: { id: req.params.id },
            data,
            include: { 
                items: { include: { menuItem: { select: { name: true, imageUrl: true, basePrice: true } } } },
                table: { select: { tableNumber: true } }
            },
        });

        res.json({ success: true, data: updated });
    } catch (err) { next(err); }
};

// ─── Update Status ────────────────────────────────────────────────────────────
const updateStatus = async (req, res, next) => {
    try {
        const { status } = req.body;
        const allowed = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'];
        if (!allowed.includes(status)) throw new AppError('Invalid status', 400);

        const reservation = await prisma.reservation.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!reservation) throw new AppError('Reservation not found', 404);

        const updated = await prisma.reservation.update({
            where: { id: req.params.id },
            data: { status },
        });

        res.json({ success: true, data: updated });
    } catch (err) { next(err); }
};

// ─── Mark as Paid ─────────────────────────────────────────────────────────────
const markPaid = async (req, res, next) => {
    try {
        const reservation = await prisma.reservation.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!reservation) throw new AppError('Reservation not found', 404);

        const updated = await prisma.reservation.update({
            where: { id: req.params.id },
            data: { isPaid: true },
        });

        res.json({ success: true, data: updated });
    } catch (err) { next(err); }
};

// ─── Delete Reservation ───────────────────────────────────────────────────────
const deleteReservation = async (req, res, next) => {
    try {
        const reservation = await prisma.reservation.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!reservation) throw new AppError('Reservation not found', 404);
        if (reservation.status === 'COMPLETED')
            throw new AppError('Cannot delete a completed reservation', 400);

        await prisma.reservation.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: 'Reservation deleted' });
    } catch (err) { next(err); }
};

module.exports = {
    listReservations, getReservation, createReservation,
    updateReservation, updateStatus, markPaid, deleteReservation,
};