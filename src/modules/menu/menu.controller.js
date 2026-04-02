// src/modules/menu/menu.controller.js
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { prisma } = require('../../config/db');
const { AppError } = require('../../middleware/errorHandler');


// ─── Cloudinary Config ────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Image Upload (Cloudinary) ────────────────────────────────────────────────
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'restoApp/menu',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }],
    public_id: (req, file) => `menu-${uuidv4()}`, // unique filename
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new AppError('Only jpg, png, webp images are allowed', 400));
  },
});

const uploadMenuImage = [
  upload.single('image'),
  (req, res, next) => {
    try {
      if (!req.file) throw new AppError('No file uploaded', 400);
      // Cloudinary returns the URL in req.file.path
      const url = req.file.path;
      res.json({ success: true, url });
    } catch (err) { next(err); }
  },
];

// ─── Delete old Cloudinary image (helper) ─────────────────────────────────────
const deleteCloudinaryImage = async (imageUrl) => {
  if (!imageUrl || !imageUrl.includes('cloudinary')) return;
  try {
    // Extract public_id from URL
    const parts = imageUrl.split('/');
    const file = parts[parts.length - 1].split('.')[0]; // filename without extension
    const folder = parts[parts.length - 2];               // folder name
    const publicId = `restoApp/menu/${file}`;
    await cloudinary.uploader.destroy(publicId);
  } catch (e) {
    console.warn('Failed to delete Cloudinary image:', e.message);
  }
};

// ─── Public Menu ──────────────────────────────────────────────────────────────
const publicMenu = async (req, res, next) => {
  try {
    const { tenantSlug, branchId } = req.params;
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant || !tenant.isActive) throw new AppError('Menu not available', 404);

    const categories = await prisma.category.findMany({
      where: { tenantId: tenant.id, isActive: true },
      include: {
        menuItems: {
          where: { isAvailable: true, isArchived: false },
          include: { variants: { where: { isAvailable: true } }, modifiers: true },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ success: true, data: categories });
  } catch (err) { next(err); }
};

const listCategories = async (req, res, next) => {
  try {
    const cats = await prisma.category.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: cats });
  } catch (err) { next(err); }
};

const createCategory = async (req, res, next) => {
  try {
    const cat = await prisma.category.create({ data: { ...req.body, tenantId: req.user.tenantId } });
    res.status(201).json({ success: true, data: cat });
  } catch (err) { next(err); }
};

const updateCategory = async (req, res, next) => {
  try {
    const cat = await prisma.category.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
    if (!cat) throw new AppError('Category not found', 404);
    const updated = await prisma.category.update({ where: { id: req.params.id }, data: req.body });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
};

const deleteCategory = async (req, res, next) => {
  try {
    const count = await prisma.menuItem.count({ where: { categoryId: req.params.id, isArchived: false } });
    if (count > 0) throw new AppError('Category has active items. Archive them first.', 400);
    await prisma.category.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Category deleted' });
  } catch (err) { next(err); }
};

const listItems = async (req, res, next) => {
  try {
    const { categoryId, available, includeInventory } = req.query;
    const where = { tenantId: req.user.tenantId, isArchived: false };
    if (categoryId) where.categoryId = categoryId;
    if (available !== undefined) where.isAvailable = available === 'true';

    const include = { category: { select: { name: true } }, variants: true, modifiers: true };
    if (includeInventory === 'true') {
      include.inventoryLinks = {
        include: {
          inventory: {
            select: { id: true, name: true, unit: true, quantity: true, lowStockAt: true, branchId: true }
          }
        }
      };
    }


    const items = await prisma.menuItem.findMany({
      where,
      include,
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: items });
  } catch (err) { next(err); }
};

const getItem = async (req, res, next) => {
  try {
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      include: {
        variants: true,
        modifiers: true,
        category: true,
        inventoryLinks: {
          include: {
            inventory: {
              select: { id: true, name: true, unit: true, quantity: true, lowStockAt: true }
            }
          }
        }
      },
    });
    if (!item) throw new AppError('Menu item not found', 404);
    res.json({ success: true, data: item });
  } catch (err) { next(err); }
};

const createItem = async (req, res, next) => {
  try {
    const { categoryId, name, description, imageUrl, basePrice, isAvailable, trackStock, variants, modifiers, branchId } = req.body;

    const cat = await prisma.category.findFirst({ where: { id: categoryId, tenantId: req.user.tenantId } });
    if (!cat) throw new AppError('Category not found', 404);

    const item = await prisma.menuItem.create({
      data: {
        tenantId: req.user.tenantId,
        categoryId,
        branchId: branchId || req.user.branchId,
        name,
        description: description || null,
        imageUrl: imageUrl || null,
        basePrice,
        isAvailable: (isAvailable === true || isAvailable === 'true') ?? false,
        trackStock: (trackStock === true || trackStock === 'true') ?? false,
        variants: variants ? { create: variants } : undefined,
        modifiers: modifiers ? { create: modifiers } : undefined,
      },
      include: { variants: true, modifiers: true, inventoryLinks: { include: { inventory: true } } },
    });
    res.status(201).json({ success: true, data: item });
  } catch (err) { next(err); }
};

const updateItem = async (req, res, next) => {
  try {
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!item) throw new AppError('Menu item not found', 404);

    const { name, description, imageUrl, basePrice, isAvailable, trackStock, categoryId, variants, modifiers } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (imageUrl !== undefined) data.imageUrl = imageUrl;
    if (basePrice !== undefined) data.basePrice = basePrice;
    if (trackStock !== undefined) data.trackStock = trackStock === true || trackStock === 'true';
    if (isAvailable !== undefined) data.isAvailable = isAvailable === true || isAvailable === 'true';
    if (categoryId !== undefined) data.categoryId = categoryId;

    // Replace variants if provided — delete all then recreate
    if (variants !== undefined) {
      data.variants = {
        deleteMany: {},           // delete all existing
        create: variants,         // recreate from payload
      };
    }

    // Replace modifiers if provided — delete all then recreate
    if (modifiers !== undefined) {
      data.modifiers = {
        deleteMany: {},
        create: modifiers,
      };
    }

    if (imageUrl && imageUrl !== item.imageUrl && item.imageUrl) {
      await deleteCloudinaryImage(item.imageUrl);
    }

    const updated = await prisma.menuItem.update({
      where: { id: req.params.id },
      data,
      include: { variants: true, modifiers: true, inventoryLinks: { include: { inventory: true } } },
    });

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
};

// ─── Inventory Links for Menu Items ───────────────────────────────────────────
const getInventoryLinks = async (req, res, next) => {
  try {
    const links = await prisma.inventoryLink.findMany({
      where: { menuItemId: req.params.id },
      include: {
        inventory: {
          select: { id: true, name: true, unit: true, quantity: true, lowStockAt: true }
        }
      },
    });
    res.json({ success: true, data: links });
  } catch (err) { next(err); }
};

const addInventoryLink = async (req, res, next) => {
  try {
    const { inventoryId, quantityUsed } = req.body;
    const menuItemId = req.params.id;

    // Verify menu item belongs to tenant
    const menuItem = await prisma.menuItem.findFirst({
      where: { id: menuItemId, tenantId: req.user.tenantId },
    });
    if (!menuItem) throw new AppError('Menu item not found', 404);

    // Verify inventory item belongs to same tenant (through branch)
    const inventory = await prisma.inventory.findFirst({
      where: { id: inventoryId },
      include: { branch: true },
    });
    if (!inventory || inventory.branch.tenantId !== req.user.tenantId) {
      throw new AppError('Inventory item not found', 404);
    }

    // Check if link already exists
    const existing = await prisma.inventoryLink.findFirst({
      where: { menuItemId, inventoryId },
    });
    if (existing) throw new AppError('Link already exists', 400);

    const link = await prisma.inventoryLink.create({
      data: { menuItemId, inventoryId, quantityUsed: parseFloat(quantityUsed) },
      include: {
        inventory: {
          select: { id: true, name: true, unit: true, quantity: true, lowStockAt: true }
        }
      },
    });

    res.status(201).json({ success: true, data: link });
  } catch (err) { next(err); }
};

const updateInventoryLink = async (req, res, next) => {
  try {
    const { quantityUsed } = req.body;
    const { id, linkId } = req.params;

    // Verify the link exists and belongs to the menu item and tenant
    const link = await prisma.inventoryLink.findFirst({
      where: { id: linkId, menuItemId: id },
      include: {
        menuItem: true,
        inventory: { include: { branch: true } }
      },
    });

    if (!link || link.menuItem.tenantId !== req.user.tenantId) {
      throw new AppError('Inventory link not found', 404);
    }

    const updated = await prisma.inventoryLink.update({
      where: { id: linkId },
      data: { quantityUsed: parseFloat(quantityUsed) },
      include: {
        inventory: {
          select: { id: true, name: true, unit: true, quantity: true, lowStockAt: true }
        }
      },
    });

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
};

const removeInventoryLink = async (req, res, next) => {
  try {
    const { id, linkId } = req.params;

    // Verify the link exists and belongs to the menu item and tenant
    const link = await prisma.inventoryLink.findFirst({
      where: { id: linkId, menuItemId: id },
      include: { menuItem: true },
    });

    if (!link || link.menuItem.tenantId !== req.user.tenantId) {
      throw new AppError('Inventory link not found', 404);
    }

    await prisma.inventoryLink.delete({ where: { id: linkId } });
    res.json({ success: true, message: 'Inventory link removed' });
  } catch (err) { next(err); }
};

// ─── Recipe Management ───────────────────────────────────────────────────────
const getRecipes = async (req, res, next) => {
  try {
    const recipes = await prisma.recipe.findMany({
      where: { menuItemId: req.params.id },
      include: {
        ingredients: {
          include: {
            inventory: {
              select: { id: true, name: true, unit: true, quantity: true, lowStockAt: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: recipes });
  } catch (err) { next(err); }
};

// const createRecipe = async (req, res, next) => {
//   try {
//     const { name, description, servings = 1, ingredients = [] } = req.body;
//     const menuItemId = req.params.id;

//     // Verify menu item belongs to tenant
//     const menuItem = await prisma.menuItem.findFirst({
//       where: { id: menuItemId, tenantId: req.user.tenantId },
//     });
//     if (!menuItem) throw new AppError('Menu item not found', 404);

//     // Validate ingredients exist and belong to same tenant
//     if (ingredients.length > 0) {
//       const inventoryIds = ingredients.map(i => i.inventoryId);
//       const inventories = await prisma.inventory.findMany({
//         where: {
//           id: { in: inventoryIds },
//           branch: { tenantId: req.user.tenantId }
//         },
//       });
//       if (inventories.length !== inventoryIds.length) {
//         throw new AppError('Some inventory items not found', 404);
//       }
//     }

//     // 3. LOG TO CONSOLE
//     // console.log('🚀 --- DEBUG: DB INSERT BYPASS ---');
//     // console.log('Target Table: Recipe');
//     // console.log('User/Tenant:', req.user.tenantId);
//     // console.log('Payload Data:', JSON.stringify(dbPayload, null, 2));
//     // console.log('---------------------------------');


//     // const recipe = await prisma.recipe.create({
//     //   data: {
//     //     menuItemId,
//     //     name,
//     //     description: description || null,
//     //     servings,
//     //     ingredients: ingredients.length > 0 ? {
//     //       create: ingredients.map(ing => ({
//     //         inventoryId: ing.inventoryId,
//     //         quantityUsed: parseFloat(ing.quantityUsed),
//     //         unit: ing.unit || null,
//     //         notes: ing.notes || null,
//     //       }))
//     //     } : undefined,
//     //   },
//     //   include: {
//     //     ingredients: {
//     //       include: {
//     //         inventory: {
//     //           select: { id: true, name: true, unit: true, quantity: true, lowStockAt: true }
//     //         }
//     //       }
//     //     }
//     //   },
//     // });

//     const result = await prisma.$transaction(async (tx) => {
//       // 1. Create the Recipe
//       const recipe = await tx.recipe.create({
//         data: {
//           menuItemId,
//           name,
//           description: description || null,
//           servings,
//           ingredients: {
//             create: ingredients.map(ing => ({
//               inventoryId: ing.inventoryId,
//               quantityUsed: parseFloat(ing.quantityUsed),
//               unit: ing.unit || null,
//             }))
//           },
//         },
//       });

//       // 2. SYNC TO INVENTORY LINKS
//       // Delete old links and replace them with the new recipe ingredients
//       await tx.inventoryLink.deleteMany({ where: { menuItemId } });

//       await tx.inventoryLink.createMany({
//         data: ingredients.map(ing => ({
//           menuItemId,
//           inventoryId: ing.inventoryId,
//           quantityUsed: parseFloat(ing.quantityUsed)
//         }))
//       });

//       return recipe;
//     });

//     res.status(201).json({ success: true, data: recipe });
//   } catch (err) { next(err); }
// };


const createRecipe = async (req, res, next) => {
  try {
    const { name, description, servings = 1, ingredients = [] } = req.body;
    const menuItemId = req.params.id;

    // 1. Verify menu item belongs to tenant
    const menuItem = await prisma.menuItem.findFirst({
      where: { id: menuItemId, tenantId: req.user.tenantId },
    });
    if (!menuItem) throw new AppError('Menu item not found', 404);

    // 2. Validate ingredients exist and belong to same tenant
    if (ingredients.length > 0) {
      const inventoryIds = ingredients.map(i => i.inventoryId);
      const inventories = await prisma.inventory.findMany({
        where: {
          id: { in: inventoryIds },
          branch: { tenantId: req.user.tenantId }
        },
      });
      if (inventories.length !== inventoryIds.length) {
        throw new AppError('Some inventory items not found', 404);
      }
    }

    // 3. Execute Transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the Recipe and its ingredients
      const recipe = await tx.recipe.create({
        data: {
          menuItemId,
          name,
          description: description || null,
          servings,
          ingredients: {
            create: ingredients.map(ing => ({
              inventoryId: ing.inventoryId,
              quantityUsed: parseFloat(ing.quantityUsed),
              unit: ing.unit || null,
            }))
          },
        },
        include: {
          ingredients: {
            include: { inventory: true }
          }
        }
      });

      // SYNC TO INVENTORY LINKS
      // This ensures your stock-tracking logic stays updated
      await tx.inventoryLink.deleteMany({ where: { menuItemId } });

      if (ingredients.length > 0) {
        await tx.inventoryLink.createMany({
          data: ingredients.map(ing => ({
            menuItemId,
            inventoryId: ing.inventoryId,
            quantityUsed: parseFloat(ing.quantityUsed)
          }))
        });
      }

      return recipe;
    });

    // 4. Send the result (was previously 'recipe', which was undefined here)
    res.status(201).json({ success: true, data: result });

  } catch (err) {
    next(err);
  }
};
const updateRecipe = async (req, res, next) => {
  try {
    const { name, description, servings, ingredients } = req.body;
    const { id, recipeId } = req.params;

    // Verify recipe belongs to menu item and tenant
    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId, menuItemId: id },
      include: { menuItem: true },
    });
    if (!recipe || recipe.menuItem.tenantId !== req.user.tenantId) {
      throw new AppError('Recipe not found', 404);
    }

    const data = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (servings !== undefined) data.servings = servings;

    // Replace ingredients if provided
    if (ingredients !== undefined) {
      // Validate ingredients exist
      if (ingredients.length > 0) {
        const inventoryIds = ingredients.map(i => i.inventoryId);
        const inventories = await prisma.inventory.findMany({
          where: {
            id: { in: inventoryIds },
            branch: { tenantId: req.user.tenantId }
          },
        });
        if (inventories.length !== inventoryIds.length) {
          throw new AppError('Some inventory items not found', 404);
        }
      }

      data.ingredients = {
        deleteMany: {},
        create: ingredients.map(ing => ({
          inventoryId: ing.inventoryId,
          quantityUsed: parseFloat(ing.quantityUsed),
          unit: ing.unit || null,
          notes: ing.notes || null,
        }))
      };
    }

    const updated = await prisma.recipe.update({
      where: { id: recipeId },
      data,
      include: {
        ingredients: {
          include: {
            inventory: {
              select: { id: true, name: true, unit: true, quantity: true, lowStockAt: true }
            }
          }
        }
      },
    });

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
};

const deleteRecipe = async (req, res, next) => {
  try {
    const { id, recipeId } = req.params;

    // Verify recipe belongs to menu item and tenant
    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId, menuItemId: id },
      include: { menuItem: true },
    });
    if (!recipe || recipe.menuItem.tenantId !== req.user.tenantId) {
      throw new AppError('Recipe not found', 404);
    }

    await prisma.recipe.delete({ where: { id: recipeId } });
    res.json({ success: true, message: 'Recipe deleted' });
  } catch (err) { next(err); }
};

const archiveItem = async (req, res, next) => {
  try {
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!item) throw new AppError('Menu item not found', 404);

    // Delete Cloudinary image when archiving
    if (item.imageUrl) await deleteCloudinaryImage(item.imageUrl);

    await prisma.menuItem.updateMany({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      data: { isArchived: true, isAvailable: false },
    });
    res.json({ success: true, message: 'Item archived' });
  } catch (err) { next(err); }
};

const toggleAvailability = async (req, res, next) => {
  try {
    const item = await prisma.menuItem.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
    if (!item) throw new AppError('Menu item not found', 404);
    const updated = await prisma.menuItem.update({
      where: { id: req.params.id },
      data: { isAvailable: !item.isAvailable },
    });
    res.json({ success: true, data: { id: updated.id, isAvailable: updated.isAvailable } });
  } catch (err) { next(err); }
};

// ─── QR Code Generation ───────────────────────────────────────────────────────
const generateTableQR = async (req, res, next) => {
  try {
    const { branchId, tableNumber, capacity } = req.body;
    const { tenantId } = req.user;

    const branch = await prisma.branch.findFirst({ where: { id: branchId, tenantId } });
    if (!branch) throw new AppError('Branch not found', 404);

    const qrCode = uuidv4();
    const qrUrl = `${process.env.QR_BASE_URL}?qr=${qrCode}`;
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'H', width: 400 });

    const table = await prisma.table.upsert({
      where: { branchId_tableNumber: { branchId, tableNumber } },
      update: { qrCode, capacity: capacity || 4 },
      create: { tenantId, branchId, tableNumber, qrCode, capacity: capacity || 4 },
    });

    res.json({ success: true, data: { table, qrUrl, qrDataUrl } });
  } catch (err) { next(err); }
};

const listTables = async (req, res, next) => {
  try {
    const tables = await prisma.table.findMany({
      where: { branchId: req.params.branchId, tenantId: req.user.tenantId },
      orderBy: { tableNumber: 'asc' },
    });
    const withUrls = tables.map((t) => ({ ...t, qrUrl: `${process.env.QR_BASE_URL}?qr=${t.qrCode}` }));
    res.json({ success: true, data: withUrls });
  } catch (err) { next(err); }
};

module.exports = {
  publicMenu, listCategories, createCategory, updateCategory, deleteCategory,
  listItems, getItem, createItem, updateItem, archiveItem, toggleAvailability,
  generateTableQR, listTables, uploadMenuImage,
  getInventoryLinks, addInventoryLink, updateInventoryLink, removeInventoryLink,
  getRecipes, createRecipe, updateRecipe, deleteRecipe,
};