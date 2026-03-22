// src/modules/orders/order.validators.js
const Joi = require('joi');

const orderItem = Joi.object({
  menuItemId:  Joi.string().uuid().required(),
  variantId:   Joi.string().uuid().optional().allow(null),
  modifierIds: Joi.array().items(Joi.string().uuid()).default([]).allow(null),
  quantity:    Joi.number().integer().min(1).max(99).required(),
  notes:       Joi.string().max(200).optional().allow(null, ''),
});

module.exports = {
  create: {
    body: Joi.object({
      tableId:       Joi.string().uuid().optional().allow(null),
      branchId:      Joi.string().uuid().required(),
      orderType:     Joi.string().valid('DINE_IN', 'TAKEOUT', 'DELIVERY').default('DINE_IN'),
      items:         Joi.array().items(orderItem).min(1).required(),
      notes:         Joi.string().max(500).optional().allow(null, ''),
      customerId:    Joi.string().uuid().optional().allow(null),
      clientOrderId: Joi.string().max(100).optional().allow(null),
      discountAmount:Joi.number().min(0).default(0),
    }),
  },
  qrOrder: {
    body: Joi.object({
      qrCode:        Joi.string().required(),
      items:         Joi.array().items(orderItem).min(1).required(),
      notes:         Joi.string().max(500).optional(),
      customerName:  Joi.string().max(100).optional(),
      customerPhone: Joi.string().max(20).optional(),
    }),
  },
  listQuery: {
    params: Joi.object({ branchId: Joi.string().uuid().required() }),
    query: Joi.object({
      status:    Joi.string().valid('PENDING','CONFIRMED','PREPARING','READY','SERVED','COMPLETED','CANCELLED').optional(),
      orderType: Joi.string().valid('DINE_IN','TAKEOUT','DELIVERY','QR_ORDER').optional(),
      date:      Joi.string().isoDate().optional(),
      page:      Joi.number().integer().min(1).default(1),
      limit:     Joi.number().integer().min(1).max(100).default(20),
    }),
  },
  updateStatus: {
    body: Joi.object({
      status: Joi.string().valid('CONFIRMED','PREPARING','READY','SERVED','COMPLETED','CANCELLED').required(),
      note:   Joi.string().max(200).optional().allow(null, ''),
    }),
  },
  pay: {
    body: Joi.object({
      paymentMethod:       Joi.string().valid('CASH','CARD','GCASH','MAYA','OTHER').required(),
      amountTendered:      Joi.number().min(0).optional().allow(null),
      loyaltyPointsRedeem: Joi.number().integer().min(0).default(0),
    }),
  },
  updateItemStatus: {
    body: Joi.object({
      status: Joi.string().valid('PENDING','PREPARING','DONE','CANCELLED').required(),
    }),
  },
};
