// src/utils/pricing.js
// The server ALWAYS computes prices. Client-submitted prices are IGNORED.
const { prisma } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

/**
 * Compute the server-authoritative price for a list of order items.
 * @param {Array} items - [{menuItemId, variantId, modifierIds, quantity}]
 * @param {string} tenantId
 * @returns {Promise<{computedItems, subtotal}>}
 */
async function computeOrderPricing(items, tenantId) {
  const computedItems = [];
  let subtotal = 0;

  for (const item of items) {
    const menuItem = await prisma.menuItem.findFirst({
      where: { id: item.menuItemId, tenantId, isArchived: false },
      include: { variants: true, modifiers: true },
    });

    if (!menuItem) throw new AppError(`Menu item ${item.menuItemId} not found`, 404);
    if (!menuItem.isAvailable) throw new AppError(`${menuItem.name} is currently unavailable`, 400);

    let unitPrice = parseFloat(menuItem.basePrice);

    // Apply variant price addon
    if (item.variantId) {
      const variant = menuItem.variants.find((v) => v.id === item.variantId);
      if (!variant) throw new AppError(`Variant ${item.variantId} not found`, 404);
      if (!variant.isAvailable) throw new AppError(`Variant is unavailable`, 400);
      unitPrice += parseFloat(variant.priceAddon);
    }

    // Apply modifiers
    const selectedModifiers = [];
    if (item.modifierIds?.length) {
      for (const modId of item.modifierIds) {
        const mod = menuItem.modifiers.find((m) => m.id === modId);
        if (!mod) throw new AppError(`Modifier ${modId} not found`, 404);
        unitPrice += parseFloat(mod.priceAddon);
        selectedModifiers.push({ id: mod.id, name: mod.name, priceAddon: mod.priceAddon });
      }
    }

    // Validate required modifiers
    const requiredMods = menuItem.modifiers.filter((m) => m.isRequired);
    for (const req of requiredMods) {
      if (!item.modifierIds?.includes(req.id)) {
        throw new AppError(`Required modifier "${req.name}" missing for ${menuItem.name}`, 400);
      }
    }

    const itemSubtotal = parseFloat((unitPrice * item.quantity).toFixed(2));
    subtotal += itemSubtotal;

    computedItems.push({
      menuItemId: item.menuItemId,
      variantId: item.variantId || null,
      name: menuItem.name,
      unitPrice: parseFloat(unitPrice.toFixed(2)),
      quantity: item.quantity,
      subtotal: itemSubtotal,
      modifiers: selectedModifiers.length ? JSON.stringify(selectedModifiers) : null,
      notes: item.notes || null,
    });
  }

  return { computedItems, subtotal: parseFloat(subtotal.toFixed(2)) };
}

/**
 * Compute tax and total
 */
function computeTotals({ subtotal, discountAmount = 0, taxRate = 0 }) {
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const tax = parseFloat((afterDiscount * taxRate).toFixed(2));
  const total = parseFloat((afterDiscount + tax).toFixed(2));
  return { subtotal, discount: discountAmount, tax, total };
}

module.exports = { computeOrderPricing, computeTotals };
