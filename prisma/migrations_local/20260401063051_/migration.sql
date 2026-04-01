/*
  Warnings:

  - You are about to drop the column `branchId` on the `ReservationItem` table. All the data in the column will be lost.
  - You are about to drop the column `tableId` on the `ReservationItem` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReservationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reservationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "subtotal" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    CONSTRAINT "ReservationItem_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReservationItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ReservationItem" ("id", "menuItemId", "name", "notes", "quantity", "reservationId", "subtotal", "unitPrice") SELECT "id", "menuItemId", "name", "notes", "quantity", "reservationId", "subtotal", "unitPrice" FROM "ReservationItem";
DROP TABLE "ReservationItem";
ALTER TABLE "new_ReservationItem" RENAME TO "ReservationItem";
CREATE INDEX "ReservationItem_reservationId_idx" ON "ReservationItem"("reservationId");
CREATE INDEX "ReservationItem_menuItemId_idx" ON "ReservationItem"("menuItemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
