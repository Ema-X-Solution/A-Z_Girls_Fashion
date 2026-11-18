-- AlterTable
ALTER TABLE "User" ADD COLUMN     "employeeCode" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "returnRule" TEXT NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "netBeforeTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "receiptNumber" TEXT,
ADD COLUMN     "receiptSnapshot" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "taxMode" TEXT NOT NULL DEFAULT 'EXCLUSIVE',
ADD COLUMN     "taxRate" DECIMAL(7,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "returnRule" TEXT NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "sku" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SalePayment" ADD COLUMN     "authorizationCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "cardBrand" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "cardLast4" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SaleReturn" ADD COLUMN     "creditAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "reasonType" TEXT NOT NULL DEFAULT 'CHANGE_MIND',
ADD COLUMN     "refundAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Exchange" (
    "id" UUID NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "originalSaleId" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "replacementSaleId" UUID NOT NULL,
    "difference" DECIMAL(18,2) NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exchange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Exchange_number_key" ON "Exchange"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Exchange_returnId_key" ON "Exchange"("returnId");

-- CreateIndex
CREATE UNIQUE INDEX "Exchange_replacementSaleId_key" ON "Exchange"("replacementSaleId");

-- CreateIndex
CREATE INDEX "Exchange_originalSaleId_createdAt_idx" ON "Exchange"("originalSaleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeCode_key" ON "User"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_receiptNumber_key" ON "Sale"("receiptNumber");

-- AddForeignKey
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SaleReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_replacementSaleId_fkey" FOREIGN KEY ("replacementSaleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "Sale" SET "netBeforeTax"=total-tax;
UPDATE "SaleItem" i SET sku=v.sku FROM "ProductVariant" v WHERE v.id=i."variantId";
UPDATE "SaleReturn" SET "refundAmount"=total;
UPDATE "SystemSetting" SET value=jsonb_build_object('taxMode','EXCLUSIVE','invoicePrefix','INV','branchName','','taxNumber','','commercialRegister','','returnPolicy',
$policy$1. يُسمح بالاستبدال أو الاسترجاع خلال 14 يوماً من تاريخ الشراء بأصل الفاتورة وبنفس حالة الشراء والباركود الأصلي.
2. لا يُسمح باستبدال أو استرجاع الملابس الداخلية (اللانجيري)، المايوهات، الباديهات الملاصقة للجسم، أو الجوارب حفاظاً على الصحة العامة، إلا في حالة وجود عيب صناعة.
3. في حالة العروض الترويجية (مثل: اشترِ قطعتين واحصل على الثالثة)، يتم رد قيمة الفاتورة بالكامل أو استبدال العرض وفق شروط الحملة.$policy$)||value WHERE key='store';
UPDATE "Sale" s SET "receiptSnapshot"=COALESCE(st.value,'{}'::jsonb)||jsonb_build_object('branchName',COALESCE(NULLIF(st.value->>'branchName',''),b.name),'cashierName',u.name,'sellerCode',COALESCE(u."employeeCode",UPPER(LEFT(u.id::text,8))),'legacySnapshot',true,'legacyTaxRateUnknown',true),
"receiptNumber"=COALESCE(st.value->>'invoicePrefix','INV')||'-'||to_char(s."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo','YYYY')||'-'||LPAD(s.number::text,GREATEST(5,LENGTH(s.number::text)),'0')
FROM "Branch" b,"User" u,"SystemSetting" st WHERE b.id=s."branchId" AND u.id=s."userId" AND st.key='store';
ALTER TABLE "Sale" ADD CONSTRAINT "sale_tax_equation" CHECK("netBeforeTax"+tax=total AND "taxMode" IN ('INCLUSIVE','EXCLUSIVE') AND "taxRate">=0 AND "taxRate"<=100);
ALTER TABLE "SaleReturn" ADD CONSTRAINT "return_settlement_equation" CHECK("refundAmount">=0 AND "creditAmount">=0 AND "refundAmount"+"creditAmount"=total);
ALTER TABLE "Product" ADD CONSTRAINT "product_return_rule" CHECK("returnRule" IN ('STANDARD','DEFECT_ONLY'));
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_originalSaleId_fkey" FOREIGN KEY("originalSaleId") REFERENCES "Sale"(id);
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_createdBy_fkey" FOREIGN KEY("createdBy") REFERENCES "User"(id);
CREATE TRIGGER "exchange_immutable" BEFORE UPDATE OR DELETE ON "Exchange" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER "sale_payments_immutable" BEFORE UPDATE OR DELETE ON "SalePayment" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER "sale_returns_immutable" BEFORE UPDATE OR DELETE ON "SaleReturn" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE FUNCTION protect_sale_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD."receiptNumber" IS NOT NULL AND ROW(NEW.subtotal,NEW.discount,NEW.tax,NEW.total,NEW."netBeforeTax",NEW."taxRate",NEW."taxMode",NEW."receiptNumber",NEW."receiptSnapshot",NEW."createdAt") IS DISTINCT FROM ROW(OLD.subtotal,OLD.discount,OLD.tax,OLD.total,OLD."netBeforeTax",OLD."taxRate",OLD."taxMode",OLD."receiptNumber",OLD."receiptSnapshot",OLD."createdAt") THEN RAISE EXCEPTION 'Posted invoice snapshots are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER "sale_snapshot_immutable" BEFORE UPDATE ON "Sale" FOR EACH ROW EXECUTE FUNCTION protect_sale_snapshot();
CREATE FUNCTION protect_sale_item_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.sku,NEW.name,NEW.options,NEW.barcode,NEW.quantity,NEW."unitPrice",NEW."unitCost",NEW.discount,NEW.tax,NEW.total,NEW."returnRule") IS DISTINCT FROM ROW(OLD.sku,OLD.name,OLD.options,OLD.barcode,OLD.quantity,OLD."unitPrice",OLD."unitCost",OLD.discount,OLD.tax,OLD.total,OLD."returnRule") THEN RAISE EXCEPTION 'Posted invoice items are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER "sale_item_snapshot_immutable" BEFORE UPDATE ON "SaleItem" FOR EACH ROW EXECUTE FUNCTION protect_sale_item_snapshot();
-- Existing invoices retain their posted totals; only metadata snapshots are backfilled below.
