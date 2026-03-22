// src/modules/branches/branch.controller.js
const { prisma } = require('../../config/db');
const { AppError } = require('../../middleware/errorHandler');

const list = async (req, res, next) => {
  try {
    const branches = await prisma.branch.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: branches });
  } catch (err) { next(err); }
};

const getOne = async (req, res, next) => {
  try {
    const branch = await prisma.branch.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      include: { users: { select: { id: true, name: true, role: true, isActive: true } } },
    });
    if (!branch) throw new AppError('Branch not found', 404);
    res.json({ success: true, data: branch });
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const branch = await prisma.branch.create({
      data: { tenantId: req.user.tenantId, ...req.body },
    });
    res.status(201).json({ success: true, data: branch });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const branch = await prisma.branch.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
    if (!branch) throw new AppError('Branch not found', 404);
    const updated = await prisma.branch.update({ where: { id: req.params.id }, data: req.body });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
};

const deactivate = async (req, res, next) => {
  try {
    const branch = await prisma.branch.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
    if (!branch) throw new AppError('Branch not found', 404);
    await prisma.branch.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, message: 'Branch deactivated' });
  } catch (err) { next(err); }
};

module.exports = { list, getOne, create, update, deactivate };
