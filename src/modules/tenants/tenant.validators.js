// src/modules/tenants/tenant.validators.js
const Joi = require('joi');

module.exports = {
  register: {
    body: Joi.object({
      tenantName:     Joi.string().max(100).required(),
      slug:           Joi.string().lowercase().alphanum().min(3).max(30).required(),
      ownerName:      Joi.string().max(100).required(),
      ownerEmail:     Joi.string().email().required(),
      ownerPassword:  Joi.string().min(8).required(),
      branchName:     Joi.string().max(100).optional(),
      branchAddress:  Joi.string().max(300).optional(),
    }),
  },
  update: {
    body: Joi.object({
      name:    Joi.string().max(100).optional(),
      logoUrl: Joi.string().uri().optional(),
    }),
  },
};
