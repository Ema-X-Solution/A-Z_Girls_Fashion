-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "PurchaseReceiptItem" ADD COLUMN     "lineTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "returned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SupplierPayment" ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reference" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "shiftId" UUID;

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" UUID NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "supplierId" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturn" (
    "id" UUID NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "supplierId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturnItem" (
    "id" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "receiptItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "inventoryCost" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "PurchaseReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_number_key" ON "SupplierInvoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_receiptId_key" ON "SupplierInvoice"("receiptId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_supplierId_createdAt_idx" ON "SupplierInvoice"("supplierId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReturn_number_key" ON "PurchaseReturn"("number");

-- CreateIndex
CREATE INDEX "PurchaseReturn_supplierId_createdAt_idx" ON "PurchaseReturn"("supplierId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReturnItem_returnId_receiptItemId_key" ON "PurchaseReturnItem"("returnId", "receiptItemId");

-- CreateIndex
CREATE INDEX "SupplierPayment_supplierId_createdAt_idx" ON "SupplierPayment"("supplierId", "createdAt");

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "PurchaseReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_receiptItemId_fkey" FOREIGN KEY ("receiptItemId") REFERENCES "PurchaseReceiptItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve existing account accruals and distribute receipt cents exactly.
WITH weighted AS (
 SELECT i.id, i."receiptId", r.total,
 CASE WHEN SUM(i."unitCost"*i.quantity) OVER (PARTITION BY i."receiptId")=0 THEN 0
 ELSE r.total*100*i."unitCost"*i.quantity/SUM(i."unitCost"*i.quantity) OVER (PARTITION BY i."receiptId") END AS cents
 FROM "PurchaseReceiptItem" i JOIN "PurchaseReceipt" r ON r.id=i."receiptId"
), ranked AS (
 SELECT *, ROW_NUMBER() OVER (PARTITION BY "receiptId" ORDER BY cents-FLOOR(cents) DESC,id) AS position,
 total*100-SUM(FLOOR(cents)) OVER (PARTITION BY "receiptId") AS remainder FROM weighted
)
UPDATE "PurchaseReceiptItem" i SET "lineTotal"=(FLOOR(r.cents)+CASE WHEN r.position<=r.remainder THEN 1 ELSE 0 END)/100 FROM ranked r WHERE r.id=i.id;

INSERT INTO "SupplierInvoice" (id,"supplierId","receiptId",total,"createdBy","createdAt")
SELECT r.id,p."supplierId",r.id,r.total,r."createdBy",r."createdAt" FROM "PurchaseReceipt" r JOIN "PurchaseOrder" p ON p.id=r."purchaseId" ORDER BY r."createdAt",r.id;
UPDATE "Supplier" s SET "createdAt"=COALESCE((SELECT MIN(p."createdAt") FROM "PurchaseOrder" p WHERE p."supplierId"=s.id),s."createdAt");

ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "supplier_invoice_total_nonnegative" CHECK(total>=0);
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_createdBy_fkey" FOREIGN KEY("createdBy") REFERENCES "User"(id);
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "purchase_return_total_nonnegative" CHECK(total>=0);
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_createdBy_fkey" FOREIGN KEY("createdBy") REFERENCES "User"(id);
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "purchase_return_item_valid" CHECK(quantity>0 AND amount>=0 AND "inventoryCost">=0);
ALTER TABLE "PurchaseReceiptItem" ADD CONSTRAINT "receipt_return_limits" CHECK(returned>=0 AND returned<=quantity AND "returnedAmount">=0 AND "returnedAmount"<="lineTotal");
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "supplier_payment_positive" CHECK(amount>0);
CREATE TRIGGER "supplier_invoice_immutable" BEFORE UPDATE OR DELETE ON "SupplierInvoice" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER "supplier_payment_immutable" BEFORE UPDATE OR DELETE ON "SupplierPayment" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER "purchase_return_immutable" BEFORE UPDATE OR DELETE ON "PurchaseReturn" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER "purchase_return_item_immutable" BEFORE UPDATE OR DELETE ON "PurchaseReturnItem" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
-- Existing receiving records remain the source of truth when introducing invoices.
