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
    const { categoryId, available } = req.query;
    const where = { tenantId: req.user.tenantId, isArchived: false };
    if (categoryId) where.categoryId = categoryId;
    if (available !== undefined) where.isAvailable = available === 'true';

    const items = await prisma.menuItem.findMany({
      where,
      include: { category: { select: { name: true } }, variants: true, modifiers: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: items });
  } catch (err) { next(err); }
};

const getItem = async (req, res, next) => {
  try {
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      include: { variants: true, modifiers: true, category: true },
    });
    if (!item) throw new AppError('Menu item not found', 404);
    res.json({ success: true, data: item });
  } catch (err) { next(err); }
};

const createItem = async (req, res, next) => {
  try {
    const { categoryId, name, description, imageUrl, basePrice, isAvailable, trackStock, variants, modifiers } = req.body;

    const cat = await prisma.category.findFirst({ where: { id: categoryId, tenantId: req.user.tenantId } });
    if (!cat) throw new AppError('Category not found', 404);

    const item = await prisma.menuItem.create({
      data: {
        tenantId: req.user.tenantId,
        categoryId,
        name,
        description: description || null,
        imageUrl: imageUrl || null,
        basePrice,
        isAvailable: isAvailable ?? true,
        trackStock: trackStock ?? false,
        variants: variants ? { create: variants } : undefined,
        modifiers: modifiers ? { create: modifiers } : undefined,
      },
      include: { variants: true, modifiers: true },
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
    if (isAvailable !== undefined) data.isAvailable = isAvailable;
    if (trackStock !== undefined) data.trackStock = trackStock;
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
      include: { variants: true, modifiers: true },
    });

    res.json({ success: true, data: updated });
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
};