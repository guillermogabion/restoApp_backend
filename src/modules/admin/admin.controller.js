// src/modules/admin/admin.controller.js
const { prisma } = require('../../config/db');
const bcrypt = require('bcryptjs');
const { AppError } = require('../../middleware/errorHandler');

// ─── Branches ─────────────────────────────────────────────────────────────────

const listBranches = async (req, res, next) => {
    try {
        const branches = await prisma.branch.findMany({
            where: { tenantId: req.user.tenantId },
            orderBy: { name: 'asc' },
        });
        res.json({ success: true, data: branches });
    } catch (err) { next(err); }
};

const createBranch = async (req, res, next) => {
    try {
        const { name, address, phone, openTime, closeTime, timezone } = req.body;
        const branch = await prisma.branch.create({
            data: {
                tenantId: req.user.tenantId,
                name, address,
                phone: phone || null,
                openTime: openTime || '08:00',
                closeTime: closeTime || '22:00',
                timezone: timezone || 'Asia/Manila',
            },
        });
        res.status(201).json({ success: true, data: branch });
    } catch (err) { next(err); }
};

const updateBranch = async (req, res, next) => {
    try {
        const branch = await prisma.branch.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!branch) throw new AppError('Branch not found', 404);

        const { name, address, phone, openTime, closeTime, timezone, isActive } = req.body;
        const data = {};
        if (name !== undefined) data.name = name;
        if (address !== undefined) data.address = address;
        if (phone !== undefined) data.phone = phone || null;
        if (openTime !== undefined) data.openTime = openTime;
        if (closeTime !== undefined) data.closeTime = closeTime;
        if (timezone !== undefined) data.timezone = timezone;
        if (isActive !== undefined) data.isActive = isActive;

        const updated = await prisma.branch.update({ where: { id: req.params.id }, data });
        res.json({ success: true, data: updated });
    } catch (err) { next(err); }
};

// ─── Users / Staff ─────────────────────────────────────────────────────────────

const listUsers = async (req, res, next) => {
    try {
        const { branchId, role } = req.query;
        const where = { tenantId: req.user.tenantId };

        // Non-owners can only see their own branch
        if (req.user.role !== 'OWNER' && req.user.role !== 'MANAGER') {
            where.branchId = req.user.branchId;
        } else if (branchId) {
            where.branchId = branchId;
        }

        if (role) where.role = role;

        const users = await prisma.user.findMany({
            where,
            select: {
                id: true, name: true, email: true, phone: true,
                role: true, pin: true, isActive: true, branchId: true,
                lastLogin: true, createdAt: true,
                branch: { select: { name: true } },
            },
            orderBy: [{ role: 'asc' }, { name: 'asc' }],
        });

        res.json({ success: true, data: users });
    } catch (err) { next(err); }
};

const createUser = async (req, res, next) => {
    try {
        const { name, email, password, phone, role, branchId, pin, isActive } = req.body;

        // Only owners can create managers; managers can create cashiers/kitchen/waiters
        const allowedRoles = {
            OWNER: ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN', 'WAITER', 'DELIVERY_RIDER'],
            MANAGER: ['CASHIER', 'KITCHEN', 'WAITER', 'DELIVERY_RIDER'],
        };
        const allowed = allowedRoles[req.user.role] || [];
        if (!allowed.includes(role)) {
            throw new AppError(`You cannot create a ${role} account`, 403);
        }

        // Check email uniqueness within tenant
        const existing = await prisma.user.findFirst({
            where: { tenantId: req.user.tenantId, email },
        });
        if (existing) throw new AppError('Email already in use', 409);

        // Validate branch belongs to tenant
        if (branchId) {
            const branch = await prisma.branch.findFirst({
                where: { id: branchId, tenantId: req.user.tenantId },
            });
            if (!branch) throw new AppError('Branch not found', 404);
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const user = await prisma.user.create({
            data: {
                tenantId: req.user.tenantId,
                branchId: branchId || null,
                name, email, passwordHash, role,
                phone: phone || null,
                pin: pin || null,
                isActive: isActive ?? true,
            },
            select: {
                id: true, name: true, email: true, phone: true,
                role: true, isActive: true, branchId: true, createdAt: true,
            },
        });

        res.status(201).json({ success: true, data: user });
    } catch (err) { next(err); }
};

const updateUser = async (req, res, next) => {
    try {
        const user = await prisma.user.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!user) throw new AppError('User not found', 404);

        const { name, phone, role, branchId, pin, isActive, password } = req.body;
        const data = {};

        if (name !== undefined) data.name = name;
        if (phone !== undefined) data.phone = phone || null;
        if (role !== undefined) data.role = role;
        if (branchId !== undefined) data.branchId = branchId || null;
        if (isActive !== undefined) data.isActive = isActive;
        if (pin !== undefined) data.pin = pin || null;
        if (password && password.length >= 8) {
            data.passwordHash = await bcrypt.hash(password, 12);
        }

        const updated = await prisma.user.update({
            where: { id: req.params.id },
            data,
            select: {
                id: true, name: true, email: true, phone: true,
                role: true, isActive: true, branchId: true,
            },
        });

        res.json({ success: true, data: updated });
    } catch (err) { next(err); }
};

module.exports = { listBranches, createBranch, updateBranch, listUsers, createUser, updateUser };