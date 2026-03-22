// prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── Tenant ────────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-restaurant' },
    update: {},
    create: { name: 'Demo Restaurant', slug: 'demo-restaurant', plan: 'pro' },
  });

  // ── Branch ────────────────────────────────────────────────────────────────
  // Replace the entire Branch block in seed.js with this:
  let branch = await prisma.branch.findFirst({
    where: { tenantId: tenant.id, name: 'Main Branch' },
  });
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        tenantId: tenant.id,
        name: 'Main Branch',
        address: 'Cebu City, Philippines',
        phone: '+63 32 123 4567',
        timezone: 'Asia/Manila',
      },
    });
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  const hash = (pw) => bcrypt.hashSync(pw, 12);

  const usersData = [
    { name: 'Owner Admin',   email: 'owner@demo.com',    password: 'Password123!', role: 'OWNER',          pin: '1111' },
    { name: 'Branch Manager',email: 'manager@demo.com',  password: 'Password123!', role: 'MANAGER',        pin: '2222' },
    { name: 'Cashier One',   email: 'cashier@demo.com',  password: 'Password123!', role: 'CASHIER',        pin: '3333' },
    { name: 'Kitchen Staff', email: 'kitchen@demo.com',  password: 'Password123!', role: 'KITCHEN',        pin: '4444' },
    { name: 'Waiter One',    email: 'waiter@demo.com',   password: 'Password123!', role: 'WAITER',         pin: '5555' },
    { name: 'Rider One',     email: 'rider@demo.com',    password: 'Password123!', role: 'DELIVERY_RIDER', pin: '6666' },
  ];

  for (const u of usersData) {
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
      update: {},
      create: {
        tenantId: tenant.id,
        branchId: branch.id,
        name: u.name, email: u.email,
        passwordHash: hash(u.password),
        role: u.role,
        pin: u.pin,
      },
    });
  }

  // ── Categories ────────────────────────────────────────────────────────────
  const categories = ['Meals', 'Snacks', 'Beverages', 'Desserts'];
    const createdCats = {};
    for (let i = 0; i < categories.length; i++) {
      let cat = await prisma.category.findFirst({
        where: { tenantId: tenant.id, name: categories[i] },
      });
      if (!cat) {
        cat = await prisma.category.create({
          data: { tenantId: tenant.id, name: categories[i], sortOrder: i },
        });
      }
      createdCats[categories[i]] = cat.id;
    }

  // ── Menu Items ────────────────────────────────────────────────────────────
  const menuItems = [
    { name: 'Chicken Inasal',    category: 'Meals',     price: 189 },
    { name: 'Pork Sinigang',     category: 'Meals',     price: 215 },
    { name: 'Beef Kare-Kare',    category: 'Meals',     price: 245 },
    { name: 'Crispy Pata',       category: 'Meals',     price: 499 },
    { name: 'Lumpia Shanghai',   category: 'Snacks',    price: 89  },
    { name: 'Calamari',          category: 'Snacks',    price: 125 },
    { name: 'Halo-Halo',         category: 'Desserts',  price: 99  },
    { name: 'Leche Flan',        category: 'Desserts',  price: 75  },
    { name: 'Iced Tea',          category: 'Beverages', price: 55  },
    { name: 'Soft Drinks',       category: 'Beverages', price: 45  },
    { name: 'Fresh Buko Juice',  category: 'Beverages', price: 65  },
  ];

  for (const m of menuItems) {
    const existing = await prisma.menuItem.findFirst({
      where: { tenantId: tenant.id, name: m.name },
    });
    if (!existing) {
      await prisma.menuItem.create({
        data: {
          tenantId: tenant.id,
          categoryId: createdCats[m.category],
          name: m.name,
          basePrice: m.price,
          isAvailable: true,
        },
      });
    }
  }

  // ── Tables ────────────────────────────────────────────────────────────────
  for (let t = 1; t <= 10; t++) {
    const tableNumber = String(t).padStart(2, '0');
    const qrCode = uuidv4();
    await prisma.table.upsert({
      where: { branchId_tableNumber: { branchId: branch.id, tableNumber } },
      update: {},
      create: { tenantId: tenant.id, branchId: branch.id, tableNumber, qrCode, capacity: 4 },
    });
  }

  // ── Loyalty Program ───────────────────────────────────────────────────────
  await prisma.loyaltyProgram.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id, pointsPerPeso: 1, redemptionRate: 100, minRedeemPoints: 100, isActive: true },
  });

  // ── Delivery Zone ─────────────────────────────────────────────────────────
  for (const zone of [
    { name: 'Zone A (0-3km)', fee: 50, estMinutes: 20 },
    { name: 'Zone B (3-6km)', fee: 80, estMinutes: 35 },
  ]) {
    const existing = await prisma.deliveryZone.findFirst({
      where: { branchId: branch.id, name: zone.name },
    });
    if (!existing) {
      await prisma.deliveryZone.create({
        data: { branchId: branch.id, ...zone },
      });
    }
  }

  // ── Basic Inventory ───────────────────────────────────────────────────────
  const inventoryItems = [
    { name: 'Rice',        unit: 'kg',  qty: 50,   low: 10  },
    { name: 'Chicken',     unit: 'kg',  qty: 20,   low: 5   },
    { name: 'Pork',        unit: 'kg',  qty: 15,   low: 5   },
    { name: 'Cooking Oil', unit: 'L',   qty: 10,   low: 2   },
    { name: 'Soft Drinks', unit: 'pcs', qty: 100,  low: 20  },
  ];

  for (const inv of inventoryItems) {
    const existing = await prisma.inventory.findFirst({
      where: { branchId: branch.id, name: inv.name },
    });
    if (!existing) {
      await prisma.inventory.create({
        data: { branchId: branch.id, name: inv.name, unit: inv.unit, quantity: inv.qty, lowStockAt: inv.low },
      });
    }
  }

  console.log('✅ Seed complete!');
  console.log('\n📋 Demo Login Credentials:');
  console.log('   Tenant Slug : demo-restaurant');
  console.log('   Owner       : owner@demo.com   / Password123!');
  console.log('   Manager     : manager@demo.com / Password123!');
  console.log('   Cashier     : cashier@demo.com / Password123!');
  console.log('   Kitchen     : kitchen@demo.com / Password123!');
  console.log('   Waiter      : waiter@demo.com  / Password123!');
  console.log('   Rider       : rider@demo.com   / Password123!');
  console.log('\n   PIN login also works with: 1111–6666 (per role above)');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
  console.log(`   (use this for PIN login)`);
