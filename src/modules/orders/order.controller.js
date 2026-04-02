// src/modules/orders/order.controller.js
const Pusher = require('pusher');
const { prisma } = require('../../config/db');
const { computeOrderPricing, computeTotals } = require('../../utils/pricing');
const { AppError } = require('../../middleware/errorHandler');
const { generateOrderNumber, generateUniqueOrderNumber } = require('../../utils/helpers');
const { handleOrderReduction } = require('../../utils/inventoryAlerts');
const { InventoryCache } = require('../../utils/cache');


// Stock strategy helper: prefer recipe, fallback to inventory link
const getStockStrategy = async (dbClient, menuItemId) => {
  const recipe = await dbClient.recipe.findFirst({
    where: { menuItemId, isActive: true },
    include: { ingredients: { include: { inventory: true } } },
  });
  if (recipe && recipe.ingredients?.length > 0) {
    return { type: 'recipe', recipe };
  }

  const links = await dbClient.inventoryLink.findMany({
    where: { menuItemId },
    include: { inventory: true },
  });
  if (links.length > 0) {
    return { type: 'links', links };
  }

  return null;
};

// ─── Pusher instance ──────────────────────────────────────────────────────────
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});

const emit = (channel, event, data) =>
  pusher.trigger(channel, event, data).catch((e) =>
    console.warn(`Pusher [${channel}/${event}]:`, e.message)
  );

// ─── Create Order ─────────────────────────────────────────────────────────────
// const createOrder = async (req, res, next) => {
//   try {
//     const { tenantId, branchId, userId } = req.user;
//     const { tableId, orderType, items, notes, customerId, clientOrderId, discountAmount } = req.body;

//     if (clientOrderId) {
//       const existing = await prisma.order.findUnique({
//         where: { branchId_clientOrderId: { branchId, clientOrderId } },
//       });
//       if (existing) return res.json({ success: true, data: existing, duplicate: true });
//     }

//     if (tableId) {
//       const table = await prisma.table.findFirst({ where: { id: tableId, branchId, isActive: true } });
//       if (!table) throw new AppError('Table not found in this branch', 404);
//     }

//     const { computedItems, subtotal } = await computeOrderPricing(items, tenantId);
//     const discount = discountAmount > 0 ? parseFloat(discountAmount) : 0;
//     const { total } = computeTotals({ subtotal, discountAmount: discount });

//     // Pre-validate inventory availability for items with trackStock enabled
//     for (const item of computedItems) {
//       const menuItem = await prisma.menuItem.findUnique({
//         where: { id: item.menuItemId },
//         select: { trackStock: true, name: true }
//       });

//       if (menuItem?.trackStock) {
//         const stock = await getStockStrategy(prisma, item.menuItemId);
//         if (!stock) {
//           throw new AppError(`No active recipe or inventory links found for menu item "${menuItem.name}". Please configure it first.`, 400);
//         }

//         if (stock.type === 'recipe') {
//           for (const ingredient of stock.recipe.ingredients) {
//             if (!ingredient.inventory) {
//               throw new AppError(`Recipe ingredient "${ingredient.inventory?.name || 'Unknown'}" not found in inventory for "${menuItem.name}"`, 400);
//             }
//             const requiredQuantity = parseFloat(ingredient.quantityUsed) * item.quantity;
//             if (ingredient.inventory.quantity < requiredQuantity) {
//               throw new AppError(
//                 `Insufficient inventory for "${ingredient.inventory.name}" in "${menuItem.name}". ` +
//                 `Required: ${requiredQuantity}${ingredient.unit}, Available: ${ingredient.inventory.quantity}${ingredient.inventory.unit}`,
//                 400
//               );
//             }
//           }
//         } else {
//           for (const link of stock.links) {
//             if (!link.inventory) {
//               throw new AppError(`Linked inventory item not found for "${menuItem.name}"`, 400);
//             }
//             const requiredQuantity = parseFloat(link.quantityUsed) * item.quantity;
//             if (link.inventory.quantity < requiredQuantity) {
//               throw new AppError(
//                 `Insufficient inventory for "${link.inventory.name}" in "${menuItem.name}". ` +
//                 `Required: ${requiredQuantity}${link.unit}, Available: ${link.inventory.quantity}${link.inventory.unit}`,
//                 400
//               );
//             }
//           }
//         }
//       }
//     }

//     let order;
//     let orderNumber;

//     for (let attempt = 1; attempt <= 5; attempt++) {
//       orderNumber = await generateUniqueOrderNumber(branchId);
//       try {
//         order = await prisma.$transaction(async (tx) => {
//           const newOrder = await tx.order.create({
//             data: {
//               tenantId, branchId, orderNumber,
//               tableId: tableId || null,
//               customerId: customerId || null,
//               createdByUserId: userId,
//               orderType: orderType || 'DINE_IN',
//               status: 'PENDING',
//               paymentStatus: 'UNPAID',
//               subtotal, discount, total,
//               notes: notes || null,
//               clientOrderId: clientOrderId || null,
//               syncedAt: clientOrderId ? new Date() : null,
//               items: { create: computedItems },
//             },
//             include: { items: true, table: true },
//           });

//           await tx.orderStatusHistory.create({
//             data: { orderId: newOrder.id, status: 'PENDING', changedBy: userId },
//           });

//           // Collect inventory reductions for real-time monitoring
//           const inventoryReductions = [];

//           for (const item of computedItems) {
//             // Only reduce inventory for items that have trackStock enabled
//             const menuItem = await tx.menuItem.findUnique({
//               where: { id: item.menuItemId },
//               select: { trackStock: true }
//             });

//             if (menuItem?.trackStock) {
//               const stock = await getStockStrategy(tx, item.menuItemId);
//               if (!stock) {
//                 // This should not happen if pre-validation passed, but guard anyway
//                 continue;
//               }

//               if (stock.type === 'recipe') {
//                 const recipe = stock.recipe;
//                 for (const ingredient of recipe.ingredients) {
//                   const quantityToReduce = parseFloat(ingredient.quantityUsed) * item.quantity;
//                   inventoryReductions.push({
//                     inventory: ingredient.inventory,
//                     quantityUsed: ingredient.quantityUsed,
//                     quantity: item.quantity,
//                     menuItemId: item.menuItemId,
//                     menuItemName: item.name
//                   });

//                   await tx.inventory.update({
//                     where: { id: ingredient.inventoryId },
//                     data: { quantity: { decrement: quantityToReduce } },
//                   });
//                   await tx.inventoryMovement.create({
//                     data: {
//                       inventoryId: ingredient.inventoryId,
//                       type: 'OUT',
//                       quantity: quantityToReduce,
//                       referenceId: newOrder.id,
//                       note: `Order ${orderNumber} - ${recipe.name}`,
//                       createdBy: userId,
//                     },
//                   });
//                 }
//               } else {
//                 for (const link of stock.links) {
//                   const quantityToReduce = parseFloat(link.quantityUsed) * item.quantity;
//                   inventoryReductions.push({
//                     inventory: link.inventory,
//                     quantityUsed: link.quantityUsed,
//                     quantity: item.quantity,
//                     menuItemId: item.menuItemId,
//                     menuItemName: item.name
//                   });

//                   await tx.inventory.update({
//                     where: { id: link.inventoryId },
//                     data: { quantity: { decrement: quantityToReduce } },
//                   });
//                   await tx.inventoryMovement.create({
//                     data: {
//                       inventoryId: link.inventoryId,
//                       type: 'OUT',
//                       quantity: quantityToReduce,
//                       referenceId: newOrder.id,
//                       note: `Order ${orderNumber} - ${item.name}`,
//                       createdBy: userId,
//                     },
//                   });
//                 }
//               }
//             }
//           }

//           return { newOrder, inventoryReductions };
//         });

//         break;
//       } catch (err) {
//         if (err?.code === 'P2002' && err?.meta?.target?.includes('orderNumber')) {
//           if (attempt === 5) {
//             throw new AppError('Could not allocate a unique order number after several attempts', 500);
//           }
//           continue;
//         }
//         throw err;
//       }
//     }

//     if (!order) {
//       throw new AppError('Unable to create order after repeated order number conflicts', 500);
//     }

//     const { newOrder, inventoryReductions } = order;

//     // Real-time inventory monitoring for order impacts
//     if (inventoryReductions.length > 0) {
//       const io = req.app.get('io');
//       await handleOrderReduction(io, branchId, tenantId, inventoryReductions);

//       // Invalidate inventory cache for this branch
//       InventoryCache.invalidateBranchInventory(branchId);
//     }

//     await Promise.all([
//       emit(`kitchen-${branchId}`, 'order:new', { orderId: newOrder.id, orderNumber, items: computedItems, orderType }),
//       emit(`branch-${branchId}`, 'order:created', { orderId: newOrder.id, orderNumber, total }),
//     ]);

//     res.status(201).json({ success: true, data: newOrder });
//   } catch (err) {
//     next(err);
//   }
// };
const createOrder = async (req, res, next) => {
  try {
    const { tenantId, branchId, userId } = req.user;
    const { tableId, orderType, items, notes, customerId, clientOrderId, discountAmount } = req.body;

    if (clientOrderId) {
      const existing = await prisma.order.findUnique({
        where: { branchId_clientOrderId: { branchId, clientOrderId } },
      });
      if (existing) return res.json({ success: true, data: existing, duplicate: true });
    }

    if (tableId) {
      const table = await prisma.table.findFirst({ where: { id: tableId, branchId, isActive: true } });
      if (!table) throw new AppError('Table not found in this branch', 404);
    }

    const { computedItems, subtotal } = await computeOrderPricing(items, tenantId);
    const discount = discountAmount > 0 ? parseFloat(discountAmount) : 0;
    const { total } = computeTotals({ subtotal, discountAmount: discount });

    // Pre-validate stock availability only — no deduction here
    for (const item of computedItems) {
      const menuItem = await prisma.menuItem.findUnique({
        where: { id: item.menuItemId },
        select: { trackStock: true, name: true },
      });
      if (!menuItem?.trackStock) continue;

      const stock = await getStockStrategy(prisma, item.menuItemId);
      if (!stock) {
        throw new AppError(`No active recipe or inventory links found for "${menuItem.name}". Please configure it first.`, 400);
      }

      const ingredients = stock.type === 'recipe' ? stock.recipe.ingredients : stock.links;
      for (const entry of ingredients) {
        const inv = entry.inventory;
        if (!inv) throw new AppError(`Inventory not found for "${menuItem.name}"`, 400);
        const required = parseFloat(entry.quantityUsed) * item.quantity;
        if (inv.quantity < required) {
          throw new AppError(
            `Insufficient stock for "${inv.name}" in "${menuItem.name}". ` +
            `Required: ${required}${entry.unit ?? inv.unit}, Available: ${inv.quantity}${inv.unit}`,
            400
          );
        }
      }
    }

    let order;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const orderNumber = await generateUniqueOrderNumber(branchId);
      try {
        order = await prisma.$transaction(async (tx) => {
          const newOrder = await tx.order.create({
            data: {
              tenantId, branchId, orderNumber,
              tableId: tableId || null,
              customerId: customerId || null,
              createdByUserId: userId,
              orderType: orderType || 'DINE_IN',
              status: 'PENDING',
              paymentStatus: 'UNPAID',
              subtotal, discount, total,
              notes: notes || null,
              clientOrderId: clientOrderId || null,
              syncedAt: clientOrderId ? new Date() : null,
              items: { create: computedItems },
            },
            include: { items: true, table: true },
          });
          await tx.orderStatusHistory.create({
            data: { orderId: newOrder.id, status: 'PENDING', changedBy: userId },
          });
          return newOrder;
        });
        break;
      } catch (err) {
        if (err?.code === 'P2002' && err?.meta?.target?.includes('orderNumber')) {
          if (attempt === 5) throw new AppError('Could not allocate a unique order number', 500);
          continue;
        }
        throw err;
      }
    }

    if (!order) throw new AppError('Unable to create order', 500);

    await Promise.all([
      emit(`kitchen-${branchId}`, 'order:new', { orderId: order.id, orderNumber: order.orderNumber, items: computedItems, orderType }),
      emit(`branch-${branchId}`, 'order:created', { orderId: order.id, orderNumber: order.orderNumber, total }),
    ]);

    res.status(201).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};
// ─── QR Customer Self-Order ───────────────────────────────────────────────────
const qrOrder = async (req, res, next) => {
  try {
    const { qrCode, items, notes, customerName, customerPhone } = req.body;

    const table = await prisma.table.findUnique({
      where: { qrCode },
      include: { branch: true },
    });
    if (!table || !table.isActive) throw new AppError('Invalid or inactive QR code', 400);

    const { tenantId, branchId } = table;

    let customer = null;
    if (customerPhone) {
      customer = await prisma.customer.upsert({
        where: { tenantId_phone: { tenantId, phone: customerPhone } },
        update: { name: customerName || undefined },
        create: { tenantId, name: customerName || 'Guest', phone: customerPhone },
      });
    }

    const { computedItems, subtotal } = await computeOrderPricing(items, tenantId);
    const { discount, total } = computeTotals({ subtotal, discountAmount: 0 });
    const orderNumber = await generateUniqueOrderNumber(branchId);

    // Pre-validate inventory availability for items with trackStock enabled
    for (const item of computedItems) {
      const menuItem = await prisma.menuItem.findUnique({
        where: { id: item.menuItemId },
        select: { trackStock: true, name: true }
      });

      if (menuItem?.trackStock) {
        const stock = await getStockStrategy(prisma, item.menuItemId);
        if (!stock) {
          throw new AppError(`No active recipe or inventory links found for menu item "${menuItem.name}". Please configure it first.`, 400);
        }

        if (stock.type === 'recipe') {
          for (const ingredient of stock.recipe.ingredients) {
            if (!ingredient.inventory) {
              throw new AppError(`Recipe ingredient "${ingredient.inventory?.name || 'Unknown'}" not found in inventory for "${menuItem.name}"`, 400);
            }
            const requiredQuantity = parseFloat(ingredient.quantityUsed) * item.quantity;
            if (ingredient.inventory.quantity < requiredQuantity) {
              throw new AppError(
                `Insufficient inventory for "${ingredient.inventory.name}" in "${menuItem.name}". ` +
                `Required: ${requiredQuantity}${ingredient.unit}, Available: ${ingredient.inventory.quantity}${ingredient.inventory.unit}`,
                400
              );
            }
          }
        } else {
          for (const link of stock.links) {
            if (!link.inventory) {
              throw new AppError(`Linked inventory item not found for "${menuItem.name}"`, 400);
            }
            const requiredQuantity = parseFloat(link.quantityUsed) * item.quantity;
            if (link.inventory.quantity < requiredQuantity) {
              throw new AppError(
                `Insufficient inventory for "${link.inventory.name}" in "${menuItem.name}". ` +
                `Required: ${requiredQuantity}${link.unit}, Available: ${link.inventory.quantity}${link.inventory.unit}`,
                400
              );
            }
          }
        }
      }
    }

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          tenantId, branchId, orderNumber,
          tableId: table.id,
          customerId: customer?.id || null,
          orderType: 'QR_ORDER',
          status: 'PENDING',
          paymentStatus: 'UNPAID',
          subtotal, discount, total,
          notes: notes || null,
          items: { create: computedItems },
        },
        include: { items: true },
      });

      // Collect inventory reductions for real-time monitoring
      const inventoryReductions = [];

      // Reduce inventory for items with trackStock enabled
      for (const item of computedItems) {
        const menuItem = await tx.menuItem.findUnique({
          where: { id: item.menuItemId },
          select: { trackStock: true }
        });

        if (menuItem?.trackStock) {
          const stock = await getStockStrategy(tx, item.menuItemId);
          if (!stock) {
            // This should not happen if pre-validation passed, but guard anyway
            continue;
          }

          if (stock.type === 'recipe') {
            const recipe = stock.recipe;
            for (const ingredient of recipe.ingredients) {
              const quantityToReduce = parseFloat(ingredient.quantityUsed) * item.quantity;

              // Store reduction data for real-time monitoring
              inventoryReductions.push({
                inventory: ingredient.inventory,
                quantityUsed: ingredient.quantityUsed,
                quantity: item.quantity,
                menuItemId: item.menuItemId,
                menuItemName: item.name
              });

              await tx.inventory.update({
                where: { id: ingredient.inventoryId },
                data: { quantity: { decrement: quantityToReduce } },
              });
              await tx.inventoryMovement.create({
                data: {
                  inventoryId: ingredient.inventoryId,
                  type: 'OUT',
                  quantity: quantityToReduce,
                  referenceId: newOrder.id,
                  note: `QR Order ${orderNumber} - ${recipe.name}`,
                  createdBy: null, // QR orders don't have a user
                },
              });
            }
          } else {
            for (const link of stock.links) {
              const quantityToReduce = parseFloat(link.quantityUsed) * item.quantity;

              // Store reduction data for real-time monitoring
              inventoryReductions.push({
                inventory: link.inventory,
                quantityUsed: link.quantityUsed,
                quantity: item.quantity,
                menuItemId: item.menuItemId,
                menuItemName: item.name
              });

              await tx.inventory.update({
                where: { id: link.inventoryId },
                data: { quantity: { decrement: quantityToReduce } },
              });
              await tx.inventoryMovement.create({
                data: {
                  inventoryId: link.inventoryId,
                  type: 'OUT',
                  quantity: quantityToReduce,
                  referenceId: newOrder.id,
                  note: `QR Order ${orderNumber} - ${item.name}`,
                  createdBy: null, // QR orders don't have a user
                },
              });
            }
          }
        }
      }

      return { newOrder, inventoryReductions };
    });

    const { newOrder, inventoryReductions } = order;

    // Real-time inventory monitoring for QR order impacts
    if (inventoryReductions.length > 0) {
      const io = req.app.get('io');
      await handleOrderReduction(io, branchId, tenantId, inventoryReductions);

      // Invalidate inventory cache for this branch
      InventoryCache.invalidateBranchInventory(branchId);
    }

    await emit(`kitchen-${branchId}`, 'order:new', {
      orderId: newOrder.id, orderNumber,
      items: computedItems, orderType: 'QR_ORDER', tableId: table.id,
    });

    res.status(201).json({ success: true, data: { orderId: newOrder.id, orderNumber, total } });
  } catch (err) {
    next(err);
  }
};

// ─── Validate Order Inventory ─────────────────────────────────────────────────
const validateOrderInventory = async (req, res, next) => {
  try {
    const { tenantId, branchId } = req.user;
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.json({ success: true, valid: true, warnings: [], errors: [] });
    }

    const warnings = [];
    const errors = [];

    for (const item of items) {
      const menuItem = await prisma.menuItem.findUnique({
        where: { id: item.menuItemId },
        select: { trackStock: true, name: true }
      });

      if (menuItem?.trackStock) {
        const stock = await getStockStrategy(prisma, item.menuItemId);

        if (!stock) {
          errors.push({
            menuItemId: item.menuItemId,
            menuItemName: menuItem.name,
            message: `No active recipe or inventory links found for menu item "${menuItem.name}". Please configure stock mapping first.`
          });
          continue;
        }

        if (stock.type === 'recipe') {
          const recipe = stock.recipe;
          for (const ingredient of recipe.ingredients) {
            if (!ingredient.inventory) {
              errors.push({
                menuItemId: item.menuItemId,
                menuItemName: menuItem.name,
                ingredientId: ingredient.inventoryId,
                message: `Recipe ingredient not found in inventory for "${menuItem.name}"`
              });
              continue;
            }

            const requiredQuantity = parseFloat(ingredient.quantityUsed) * item.quantity;
            const availableQuantity = ingredient.inventory.quantity;

            if (availableQuantity < requiredQuantity) {
              errors.push({
                menuItemId: item.menuItemId,
                menuItemName: menuItem.name,
                ingredientId: ingredient.inventoryId,
                ingredientName: ingredient.inventory.name,
                required: requiredQuantity,
                available: availableQuantity,
                unit: ingredient.unit,
                message: `Insufficient inventory for "${ingredient.inventory.name}" in "${menuItem.name}". Required: ${requiredQuantity}${ingredient.unit}, Available: ${availableQuantity}${ingredient.inventory.unit}`
              });
            } else if (availableQuantity < requiredQuantity * 1.2) { // Warning if less than 20% buffer
              warnings.push({
                menuItemId: item.menuItemId,
                menuItemName: menuItem.name,
                ingredientId: ingredient.inventoryId,
                ingredientName: ingredient.inventory.name,
                required: requiredQuantity,
                available: availableQuantity,
                unit: ingredient.unit,
                message: `Low inventory warning for "${ingredient.inventory.name}" in "${menuItem.name}". Required: ${requiredQuantity}${ingredient.unit}, Available: ${availableQuantity}${ingredient.inventory.unit}`
              });
            }
          }
        } else {
          for (const link of stock.links) {
            if (!link.inventory) {
              errors.push({
                menuItemId: item.menuItemId,
                menuItemName: menuItem.name,
                inventoryId: link.inventoryId,
                message: `Linked inventory item not found for "${menuItem.name}"`
              });
              continue;
            }

            const requiredQuantity = parseFloat(link.quantityUsed) * item.quantity;
            const availableQuantity = link.inventory.quantity;

            if (availableQuantity < requiredQuantity) {
              errors.push({
                menuItemId: item.menuItemId,
                menuItemName: menuItem.name,
                inventoryId: link.inventoryId,
                inventoryName: link.inventory.name,
                required: requiredQuantity,
                available: availableQuantity,
                unit: link.unit,
                message: `Insufficient inventory for "${link.inventory.name}" in "${menuItem.name}". Required: ${requiredQuantity}${link.unit}, Available: ${availableQuantity}${link.inventory.unit}`
              });
            } else if (availableQuantity < requiredQuantity * 1.2) {
              warnings.push({
                menuItemId: item.menuItemId,
                menuItemName: menuItem.name,
                inventoryId: link.inventoryId,
                inventoryName: link.inventory.name,
                required: requiredQuantity,
                available: availableQuantity,
                unit: link.unit,
                message: `Low inventory warning for "${link.inventory.name}" in "${menuItem.name}". Required: ${requiredQuantity}${link.unit}, Available: ${availableQuantity}${link.inventory.unit}`
              });
            }
          }
        }
      }
    }

    const valid = errors.length === 0;
    res.json({
      success: true,
      valid,
      warnings,
      errors,
      summary: {
        totalItems: items.length,
        itemsWithIssues: [...new Set([...warnings, ...errors].map(i => i.menuItemId))].length,
        warningCount: warnings.length,
        errorCount: errors.length
      }
    });
  } catch (err) {
    next(err);
  }
};

// ─── List Orders ──────────────────────────────────────────────────────────────
const listOrders = async (req, res, next) => {
  try {
    const { branchId } = req.params;
    const { status, orderType, date, page = 1, limit = 20 } = req.query;

    const where = { branchId, tenantId: req.user.tenantId };
    if (status) where.status = status;
    if (orderType) where.orderType = orderType;
    if (date) {
      const start = new Date(date); start.setHours(0, 0, 0, 0);
      const end = new Date(date); end.setHours(23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: true,
          table: { select: { tableNumber: true } },
          createdBy: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: parseInt(limit),
      }),
      prisma.order.count({ where }),
    ]);

    res.json({ success: true, data: orders, meta: { total, page: parseInt(page), limit: parseInt(limit) } });
  } catch (err) {
    next(err);
  }
};

// ─── Get Single Order ─────────────────────────────────────────────────────────
const getOrder = async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.orderId, tenantId: req.user.tenantId },
      include: {
        items: true,
        table: true,
        createdBy: { select: { name: true, role: true } },
        customer: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
        delivery: true,
      },
    });
    if (!order) throw new AppError('Order not found', 404);
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

// ─── Update Order Status ──────────────────────────────────────────────────────
// const updateStatus = async (req, res, next) => {
//   try {
//     const { orderId } = req.params;
//     const { status, note } = req.body;
//     const { userId, tenantId, role } = req.user;

//     const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
//     if (!order) throw new AppError('Order not found', 404);

//     const transitions = {
//       KITCHEN: ['PREPARING', 'READY'],
//       WAITER: ['SERVED'],
//       CASHIER: ['CONFIRMED', 'COMPLETED', 'CANCELLED'],
//       MANAGER: ['CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'],
//       OWNER: ['CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'],
//     };
//     const allowed = transitions[role] || [];
//     if (!allowed.includes(status)) throw new AppError(`Role ${role} cannot set status to ${status}`, 403);

//     const updated = await prisma.$transaction(async (tx) => {
//       const upd = await tx.order.update({
//         where: { id: orderId },
//         data: { status, updatedAt: new Date() },
//       });
//       await tx.orderStatusHistory.create({
//         data: { orderId, status, changedBy: userId, note: note || null },
//       });
//       return upd;
//     });

//     await emit(`branch-${order.branchId}`, 'order:status', { orderId, status, orderNumber: order.orderNumber });
//     if (['PREPARING', 'READY'].includes(status)) {
//       await emit(`kitchen-${order.branchId}`, 'order:status', { orderId, status, orderNumber: order.orderNumber });
//     }

//     res.json({ success: true, data: updated });
//   } catch (err) {
//     next(err);
//   }
// };
const updateStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status, note } = req.body;
    const { userId, tenantId, role } = req.user;

    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { items: true },   // ← need items for deduction
    });
    if (!order) throw new AppError('Order not found', 404);

    const transitions = {
      KITCHEN: ['PREPARING', 'READY'],
      WAITER: ['SERVED'],
      CASHIER: ['CONFIRMED', 'COMPLETED', 'CANCELLED'],
      MANAGER: ['CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'],
      OWNER: ['CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'],
    };
    const allowed = transitions[role] || [];
    if (!allowed.includes(status)) throw new AppError(`Role ${role} cannot set status to ${status}`, 403);

    // Guard: prevent double-deduction if already confirmed
    if (status === 'CONFIRMED' && order.status !== 'PENDING') {
      throw new AppError('Order has already been confirmed', 400);
    }

    const inventoryReductions = [];

    const updated = await prisma.$transaction(async (tx) => {
      const upd = await tx.order.update({
        where: { id: orderId },
        data: { status, updatedAt: new Date() },
      });
      await tx.orderStatusHistory.create({
        data: { orderId, status, changedBy: userId, note: note || null },
      });

      // ── Deduct inventory on CONFIRMED ──────────────────────────────
      if (status === 'CONFIRMED') {
        for (const item of order.items) {
          const menuItem = await tx.menuItem.findUnique({
            where: { id: item.menuItemId },
            select: { trackStock: true },
          });
          if (!menuItem?.trackStock) continue;

          const stock = await getStockStrategy(tx, item.menuItemId);
          if (!stock) continue;

          if (stock.type === 'recipe') {
            for (const ingredient of stock.recipe.ingredients) {
              const qty = parseFloat(ingredient.quantityUsed) * item.quantity;
              inventoryReductions.push({
                inventory: ingredient.inventory,
                quantityUsed: ingredient.quantityUsed,
                quantity: item.quantity,
                menuItemId: item.menuItemId,
                menuItemName: item.name,
              });
              await tx.inventory.update({
                where: { id: ingredient.inventoryId },
                data: { quantity: { decrement: qty } },
              });
              await tx.inventoryMovement.create({
                data: {
                  inventoryId: ingredient.inventoryId,
                  type: 'OUT',
                  quantity: qty,
                  referenceId: orderId,
                  note: `Order ${order.orderNumber} confirmed - ${stock.recipe.name}`,
                  createdBy: userId,
                },
              });
            }
          } else {
            for (const link of stock.links) {
              const qty = parseFloat(link.quantityUsed) * item.quantity;
              inventoryReductions.push({
                inventory: link.inventory,
                quantityUsed: link.quantityUsed,
                quantity: item.quantity,
                menuItemId: item.menuItemId,
                menuItemName: item.name,
              });
              await tx.inventory.update({
                where: { id: link.inventoryId },
                data: { quantity: { decrement: qty } },
              });
              await tx.inventoryMovement.create({
                data: {
                  inventoryId: link.inventoryId,
                  type: 'OUT',
                  quantity: qty,
                  referenceId: orderId,
                  note: `Order ${order.orderNumber} confirmed - ${item.name}`,
                  createdBy: userId,
                },
              });
            }
          }
        }
      }
      // ───────────────────────────────────────────────────────────────

      return upd;
    });

    // Real-time alerts after transaction commits
    if (inventoryReductions.length > 0) {
      const io = req.app.get('io');
      await handleOrderReduction(io, order.branchId, tenantId, inventoryReductions);
      InventoryCache.invalidateBranchInventory(order.branchId);
    }

    await emit(`branch-${order.branchId}`, 'order:status', { orderId, status, orderNumber: order.orderNumber });
    if (['PREPARING', 'READY'].includes(status)) {
      await emit(`kitchen-${order.branchId}`, 'order:status', { orderId, status, orderNumber: order.orderNumber });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};
// ─── Process Payment ──────────────────────────────────────────────────────────
const processPayment = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { paymentMethod, amountTendered, loyaltyPointsRedeem } = req.body;
    const { tenantId, userId } = req.user;

    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { customer: true },
    });
    if (!order) throw new AppError('Order not found', 404);
    if (order.paymentStatus === 'PAID') throw new AppError('Order already paid', 400);

    let finalTotal = parseFloat(order.total);
    let loyaltyDiscount = 0;

    if (loyaltyPointsRedeem && order.customerId && order.customer) {
      const program = await prisma.loyaltyProgram.findUnique({ where: { tenantId } });
      if (program?.isActive) {
        const maxRedeemable = Math.floor(order.customer.points / program.redemptionRate);
        const actualRedeem = Math.min(loyaltyPointsRedeem, order.customer.points, maxRedeemable * program.redemptionRate);
        loyaltyDiscount = parseFloat((actualRedeem / program.redemptionRate).toFixed(2));
        finalTotal = Math.max(0, finalTotal - loyaltyDiscount);
      }
    }

    const change = amountTendered ? Math.max(0, parseFloat(amountTendered) - finalTotal) : 0;

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: 'PAID',
          paymentMethod,
          status: 'COMPLETED',
          discount: parseFloat(order.discount) + loyaltyDiscount,
          total: finalTotal,
          updatedAt: new Date(),
        },
      });

      await tx.orderStatusHistory.create({
        data: { orderId, status: 'COMPLETED', changedBy: userId, note: `Payment: ${paymentMethod}` },
      });

      if (order.customerId) {
        const program = await tx.loyaltyProgram.findUnique({ where: { tenantId } });
        if (program?.isActive) {
          const earnedPoints = Math.floor(finalTotal * program.pointsPerPeso);
          const netPoints = earnedPoints - (loyaltyPointsRedeem || 0);
          await tx.customer.update({
            where: { id: order.customerId },
            data: { points: { increment: netPoints }, totalSpend: { increment: finalTotal } },
          });
          await tx.loyaltyTransaction.create({
            data: {
              customerId: order.customerId, orderId,
              points: netPoints,
              type: netPoints >= 0 ? 'EARN' : 'REDEEM',
            },
          });
        }
      }
    });

    await emit(`branch-${order.branchId}`, 'order:paid', {
      orderId, orderNumber: order.orderNumber, total: finalTotal,
    });

    res.json({ success: true, data: { orderId, total: finalTotal, change, paymentMethod } });
  } catch (err) {
    next(err);
  }
};

// ─── Cancel Order ─────────────────────────────────────────────────────────────
const cancelOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    const { tenantId, userId } = req.user;

    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new AppError('Order not found', 404);
    if (['COMPLETED', 'CANCELLED'].includes(order.status))
      throw new AppError('Cannot cancel this order', 400);

    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
      await tx.orderStatusHistory.create({
        data: { orderId, status: 'CANCELLED', changedBy: userId, note: reason || 'Cancelled by staff' },
      });

      const movements = await tx.inventoryMovement.findMany({
        where: { referenceId: orderId, type: 'OUT' },
      });
      for (const m of movements) {
        await tx.inventory.update({
          where: { id: m.inventoryId },
          data: { quantity: { increment: m.quantity } },
        });
        await tx.inventoryMovement.create({
          data: {
            inventoryId: m.inventoryId, type: 'IN',
            quantity: m.quantity, referenceId: orderId,
            note: 'Order cancelled reversal', createdBy: userId,
          },
        });
      }
    });

    await emit(`branch-${order.branchId}`, 'order:cancelled', {
      orderId, orderNumber: order.orderNumber, reason,
    });

    res.json({ success: true, message: 'Order cancelled' });
  } catch (err) {
    next(err);
  }
};

// ─── Update Item Status (Kitchen) ─────────────────────────────────────────────
const updateItemStatus = async (req, res, next) => {
  try {
    const { orderId, itemId } = req.params;
    const { status } = req.body;
    const { tenantId } = req.user;

    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new AppError('Order not found', 404);

    const item = await prisma.orderItem.update({ where: { id: itemId }, data: { status } });

    const allItems = await prisma.orderItem.findMany({ where: { orderId } });
    const allDone = allItems.every((i) => i.status === 'DONE' || i.status === 'CANCELLED');

    if (allDone) {
      await prisma.order.update({ where: { id: orderId }, data: { status: 'READY' } });
      await emit(`branch-${order.branchId}`, 'order:status', {
        orderId, status: 'READY', orderNumber: order.orderNumber,
      });
    }

    res.json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createOrder, qrOrder, listOrders, getOrder,
  updateStatus, processPayment, cancelOrder, updateItemStatus,
  validateOrderInventory,
};