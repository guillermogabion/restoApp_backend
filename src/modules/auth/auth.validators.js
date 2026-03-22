// src/modules/auth/auth.validators.js
const Joi = require('joi');

module.exports = {
  login: {
    body: Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().min(6).required(),
      tenantSlug: Joi.string().required(),
    }),
  },
  refresh: {
    body: Joi.object({
      refreshToken: Joi.string().required(),
    }),
  },
  pinLogin: {
    body: Joi.object({
      pin:        Joi.string().length(4).pattern(/^\d+$/).required(),
      branchId:   Joi.string().required(),   // ← removed .uuid() restriction
      tenantSlug: Joi.string().required(),
    }),
  },
  updateProfile: {
    body: Joi.object({
      name:  Joi.string().max(100).optional(),
      phone: Joi.string().max(20).optional().allow(null, ''),
    }),
  },
  changePassword: {
    body: Joi.object({
      currentPassword: Joi.string().required(),
      newPassword:     Joi.string().min(8).required(),
    }),
  },
  branches: {
    body: Joi.object({
      tenantSlug: Joi.string().required(),
    }),
  },
};
