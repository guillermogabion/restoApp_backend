// src/modules/users/user.controller.js
const bcrypt = require('bcryptjs');
const { prisma } = require('../../config/db');
const { AppError } = require('../../middleware/errorHandler');

const list = async (req, res, next) => {
  try {
    const { tenantId, branchId, role } = req.user;
    const { branchId: filterBranch, role: filterRole } = req.query;

    const where = { tenantId };

    // Managers can only see users in their own branch
    if (role === 'MANAGER') where.branchId = branchId;
    else if (filterBranch) where.branchId = filterBranch;

    if (filterRole) where.role = filterRole;

    const users = await prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, phone: true, role: true, branchId: true, isActive: true, lastLogin: true, createdAt: true },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: users });
  } catch (err) { next(err); }
};

const getOne = async (req, res, next) => {
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      select: { id: true, name: true, email: true, phone: true, role: true, branchId: true, isActive: true, lastLogin: true, createdAt: true },
    });
    if (!user) throw new AppError('User not found', 404);
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const { name, email, password, phone, role, branchId, pin } = req.body;
    const { tenantId, role: callerRole } = req.user;

    // Managers cannot create OWNER or MANAGER roles
    if (callerRole === 'MANAGER' && ['OWNER', 'MANAGER'].includes(role)) {
      throw new AppError('Managers cannot create Owner or Manager accounts', 403);
    }

    // Verify branchId belongs to this tenant
    if (branchId) {
      const branch = await prisma.branch.findFirst({ where: { id: branchId, tenantId } });
      if (!branch) throw new AppError('Branch not found', 404);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const hashedPin = pin ? await bcrypt.hash(pin, 10) : null;

    const user = await prisma.user.create({
      data: { tenantId, branchId: branchId || null, name, email, phone, passwordHash, role, pin: hashedPin },
      select: { id: true, name: true, email: true, role: true, branchId: true, createdAt: true },
    });

    res.status(201).json({ success: true, data: user });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const { name, email, phone, role, branchId, isActive } = req.body;
    const { tenantId, role: callerRole } = req.user;

    const target = await prisma.user.findFirst({ where: { id: req.params.id, tenantId } });
    if (!target) throw new AppError('User not found', 404);

    // Managers cannot promote to OWNER/MANAGER
    if (callerRole === 'MANAGER' && role && ['OWNER', 'MANAGER'].includes(role)) {
      throw new AppError('Insufficient permissions to assign this role', 403);
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { name, email, phone, role, branchId, isActive },
      select: { id: true, name: true, email: true, role: true, branchId: true, isActive: true },
    });

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
};

const deactivate = async (req, res, next) => {
  try {
    const target = await prisma.user.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
    if (!target) throw new AppError('User not found', 404);
    if (target.role === 'OWNER') throw new AppError('Cannot deactivate an Owner account', 400);

    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
    // Revoke all refresh tokens
    await prisma.refreshToken.deleteMany({ where: { userId: req.params.id } });

    res.json({ success: true, message: 'User deactivated' });
  } catch (err) { next(err); }
};

const resetPin = async (req, res, next) => {
  try {
    const { pin } = req.body;
    const target = await prisma.user.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
    if (!target) throw new AppError('User not found', 404);

    const hashed = await bcrypt.hash(pin, 10);
    await prisma.user.update({ where: { id: req.params.id }, data: { pin: hashed } });
    res.json({ success: true, message: 'PIN updated' });
  } catch (err) { next(err); }
};

module.exports = { list, getOne, create, update, deactivate, resetPin };
