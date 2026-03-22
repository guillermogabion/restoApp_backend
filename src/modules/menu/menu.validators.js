// src/modules/menu/menu.validators.js
const Joi = require('joi');

const variant = Joi.object({
  name:        Joi.string().max(50).required(),
  priceAddon:  Joi.number().min(0).default(0),
  isAvailable: Joi.boolean().default(true),
});

const modifier = Joi.object({
  name:        Joi.string().max(50).required(),
  priceAddon:  Joi.number().min(0).default(0),
  isRequired:  Joi.boolean().default(false),
});

module.exports = {
  category: {
    body: Joi.object({
      name:      Joi.string().max(80).required(),
      imageUrl:  Joi.string().uri().optional(),
      sortOrder: Joi.number().integer().min(0).default(0),
      isActive:  Joi.boolean().default(true),
    }),
  },
  createItem: {
    body: Joi.object({
      categoryId:  Joi.string().uuid().required(),
      name:        Joi.string().max(120).required(),
      description: Joi.string().max(500).optional(),
      imageUrl: Joi.string().uri().optional().allow(null, ''),
      basePrice:   Joi.number().min(0).required(),
      isAvailable: Joi.boolean().default(true),
      trackStock:  Joi.boolean().default(false),
      variants:    Joi.array().items(variant).optional(),
      modifiers:   Joi.array().items(modifier).optional(),
    }),
  },
  updateItem: {
    body: Joi.object({
      name:        Joi.string().max(120).optional(),
      description: Joi.string().max(500).optional(),
      imageUrl: Joi.string().uri().optional().allow(null, ''),
      basePrice:   Joi.number().min(0).optional(),
      isAvailable: Joi.boolean().optional(),
      trackStock:  Joi.boolean().optional(),
      categoryId:  Joi.string().uuid().optional(),
    }),
  },
  generateQR: {
    body: Joi.object({
      branchId:    Joi.string().uuid().required(),
      tableNumber: Joi.string().max(10).required(),
      capacity:    Joi.number().integer().min(1).max(50).default(4),
    }),
  },
};
