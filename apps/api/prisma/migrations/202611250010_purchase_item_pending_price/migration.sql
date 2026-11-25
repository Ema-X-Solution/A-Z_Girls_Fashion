-- Sale price / min stock typed on a purchase invoice now wait on the line until it is received.
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "salePrice" DECIMAL(18,2);
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "minStock" INTEGER;
