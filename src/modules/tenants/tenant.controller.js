// src/modules/tenants/tenant.controller.js
const bcrypt = require('bcryptjs');
const { prisma } = require('../../config/db');
const { AppError } = require('../../middleware/errorHandler');
const { signAccessToken, signRefreshToken } = require('../../utils/jwt');
const { v4: uuidv4 } = require('uuid');

// Self-service tenant registration (creates tenant + first owner user + first branch)
const register = async (req, res, next) => {
  try {
    const { tenantName, slug, ownerName, ownerEmail, ownerPassword, branchName, branchAddress } = req.body;

    const existing = await prisma.tenant.findUnique({ where: { slug } });
    if (existing) throw new AppError('Slug already taken', 409);

    const passwordHash = await bcrypt.hash(ownerPassword, 12);

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: tenantName, slug } });

      const branch = await tx.branch.create({
        data: { tenantId: tenant.id, name: branchName || 'Main Branch', address: branchAddress || '' },
      });

      const owner = await tx.user.create({
        data: {
          tenantId: tenant.id,
          branchId: branch.id,
          name: ownerName,
          email: ownerEmail,
          passwordHash,
          role: 'OWNER',
        },
      });

      // Default loyalty program
      await tx.loyaltyProgram.create({
        data: { tenantId: tenant.id, pointsPerPeso: 1, redemptionRate: 100, minRedeemPoints: 100 },
      });

      return { tenant, branch, owner };
    });

    const tokenPayload = {
      userId: result.owner.id,
      tenantId: result.tenant.id,
      branchId: result.branch.id,
      role: 'OWNER',
    };

    const accessToken  = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken({ userId: result.owner.id });

    await prisma.refreshToken.create({
      data: { id: uuidv4(), userId: result.owner.id, token: refreshToken, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });

    res.status(201).json({
      success: true,
      data: {
        tenantId: result.tenant.id,
        branchId: result.branch.id,
        accessToken,
        refreshToken,
      },
    });
  } catch (err) { next(err); }
};

const getMyTenant = async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.user.tenantId },
      include: { branches: { where: { isActive: true }, orderBy: { name: 'asc' } } },
    });
    res.json({ success: true, data: tenant });
  } catch (err) { next(err); }
};

const updateTenant = async (req, res, next) => {
  try {
    const { name, logoUrl } = req.body;
    const updated = await prisma.tenant.update({
      where: { id: req.user.tenantId },
      data: { name, logoUrl },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
};

module.exports = { register, getMyTenant, updateTenant };
