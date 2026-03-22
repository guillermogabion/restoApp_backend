// src/modules/auth/auth.controller.js
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../../config/db');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../../utils/jwt');
const { AppError } = require('../../middleware/errorHandler');

const login = async (req, res, next) => {
  try {
    const { email, password, tenantSlug } = req.body;

    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant || !tenant.isActive) throw new AppError('Tenant not found or inactive', 404);

    const user = await prisma.user.findFirst({
      where: { email, tenantId: tenant.id, isActive: true },
    });
    if (!user) throw new AppError('Invalid credentials', 401);

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AppError('Invalid credentials', 401);

    const tokenPayload = {
      userId: user.id,
      tenantId: user.tenantId,
      branchId: user.branchId,
      role: user.role,
    };

    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken({ userId: user.id });

    await prisma.refreshToken.create({
      data: {
        id: uuidv4(),
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id:       user.id,
          tenantId: user.tenantId,   // ← was missing
          branchId: user.branchId,
          name:     user.name,
          email:    user.email,
          phone:    user.phone,      // ← was missing
          role:     user.role,
          isActive: user.isActive,   // ← was missing
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

const pinLogin = async (req, res, next) => {
  try {
    const { pin, branchId, tenantSlug } = req.body;

    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) throw new AppError('Tenant not found', 404);

    // Get all active users for this branch — then bcrypt compare
    const users = await prisma.user.findMany({
      where: { branchId, tenantId: tenant.id, isActive: true },
    });

    let matchedUser = null;
    for (const u of users) {
      if (!u.pin) continue;
      // Support both plain-text PINs (seeded) and hashed PINs (created via API)
      const isHashed = u.pin.startsWith('$2');
      const match = isHashed
        ? await bcrypt.compare(pin, u.pin)
        : u.pin === pin;
      if (match) { matchedUser = u; break; }
    }

    if (!matchedUser) throw new AppError('Invalid PIN', 401);

    const accessToken = signAccessToken({
      userId:   matchedUser.id,
      tenantId: matchedUser.tenantId,
      branchId: matchedUser.branchId,
      role:     matchedUser.role,
    });

    res.json({
      success: true,
      data: {
        accessToken,
        user: {
          id:       matchedUser.id,
          tenantId: matchedUser.tenantId,
          branchId: matchedUser.branchId,
          name:     matchedUser.name,
          email:    matchedUser.email,
          phone:    matchedUser.phone,
          role:     matchedUser.role,
          isActive: matchedUser.isActive,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const payload = verifyRefreshToken(refreshToken);

    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!stored || stored.expiresAt < new Date()) {
      throw new AppError('Refresh token invalid or expired', 401);
    }

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive) throw new AppError('User not found', 401);

    const newAccessToken = signAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      branchId: user.branchId,
      role: user.role,
    });

    res.json({ success: true, data: { accessToken: newAccessToken } });
  } catch (err) {
    next(err);
  }
};

const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};

const me = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, name: true, email: true, phone: true, role: true, branchId: true, tenantId: true, lastLogin: true },
    });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const { name, phone } = req.body;
    const updated = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        ...(name  ? { name }  : {}),
        ...(phone !== undefined ? { phone } : {}),
      },
      select: { id: true, name: true, email: true, phone: true, role: true, branchId: true },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AppError('Current password is incorrect', 400);

    const newHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.userId }, data: { passwordHash: newHash } });

    // Revoke all refresh tokens so other sessions are logged out
    await prisma.refreshToken.deleteMany({ where: { userId: req.user.userId } });

    res.json({ success: true, message: 'Password changed. Please log in again.' });
  } catch (err) {
    next(err);
  }
};

const getPublicBranches = async (req, res, next) => {
  try {
    const { tenantSlug } = req.body;
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant || !tenant.isActive) throw new AppError('Tenant not found', 404);

    const branches = await prisma.branch.findMany({
      where: { tenantId: tenant.id, isActive: true },
      select: { id: true, name: true, address: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: branches });
  } catch (err) { next(err); }
};

module.exports = { login, refresh, logout, me, pinLogin, updateProfile, changePassword, getPublicBranches  };
