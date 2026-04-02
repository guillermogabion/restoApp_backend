// src/modules/menu/menu.routes.js
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const ctrl = require('./menu.controller');
const schema = require('./menu.validators');

// Public menu for QR orders (no auth needed)
router.get('/public/:tenantSlug/:branchId', ctrl.publicMenu);

router.use(authenticate);

// Categories
router.get('/categories', ctrl.listCategories);
router.post('/categories', authorize('OWNER', 'MANAGER'), validate(schema.category), ctrl.createCategory);
router.patch('/categories/:id', authorize('OWNER', 'MANAGER'), ctrl.updateCategory);
router.delete('/categories/:id', authorize('OWNER', 'MANAGER'), ctrl.deleteCategory);

// !! MUST be before /items/:id — otherwise 'upload-image' is matched as :id
router.post('/items/upload-image', authorize('OWNER', 'MANAGER'), ctrl.uploadMenuImage);

// Items
router.get('/items', ctrl.listItems);
router.get('/items/:id', ctrl.getItem);
router.post('/items', authorize('OWNER', 'MANAGER'), validate(schema.createItem), ctrl.createItem);
router.patch('/items/:id', authorize('OWNER', 'MANAGER'), validate(schema.updateItem), ctrl.updateItem);
router.delete('/items/:id', authorize('OWNER', 'MANAGER'), ctrl.archiveItem);

// Availability toggle
router.patch('/items/:id/availability', authorize('OWNER', 'MANAGER', 'CASHIER'), ctrl.toggleAvailability);

// Inventory Links for Menu Items
router.get('/items/:id/inventory-links', authorize('OWNER', 'MANAGER'), ctrl.getInventoryLinks);
router.post('/items/:id/inventory-links', authorize('OWNER', 'MANAGER'), ctrl.addInventoryLink);
router.patch('/items/:id/inventory-links/:linkId', authorize('OWNER', 'MANAGER'), ctrl.updateInventoryLink);
router.delete('/items/:id/inventory-links/:linkId', authorize('OWNER', 'MANAGER'), ctrl.removeInventoryLink);

// Recipes for Menu Items
router.get('/items/:id/recipes', authorize('OWNER', 'MANAGER'), ctrl.getRecipes);
router.post('/items/:id/recipes', authorize('OWNER', 'MANAGER'), ctrl.createRecipe);
router.patch('/items/:id/recipes/:recipeId', authorize('OWNER', 'MANAGER'), ctrl.updateRecipe);
router.delete('/items/:id/recipes/:recipeId', authorize('OWNER', 'MANAGER'), ctrl.deleteRecipe);

// QR code for table
router.post('/qr/table', authorize('OWNER', 'MANAGER'), validate(schema.generateQR), ctrl.generateTableQR);
router.get('/qr/tables/:branchId', authorize('OWNER', 'MANAGER', 'CASHIER'), ctrl.listTables);

module.exports = router;