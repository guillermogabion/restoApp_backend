const { prisma } = require('./src/config/db');
(async () => {
  const branch = await prisma.branch.findFirst({ where: { isActive: true }, include: { tables: true } });
  console.log('branch', branch ? { id: branch.id, name: branch.name, tables: branch.tables?.length } : null);
  if (!branch) return;
  const table = await prisma.table.findFirst({ where: { branchId: branch.id, isActive: true } });
  console.log('table', table ? { id: table.id, qrCode: table.qrCode } : null);
  const menuItem = await prisma.menuItem.findFirst({ where: { branchId: branch.id, isArchived: false, isAvailable: true } });
  console.log('menuItem', menuItem ? { id: menuItem.id, name: menuItem.name, trackStock: menuItem.trackStock, basePrice: menuItem.basePrice } : null);
  process.exit(0);
})();