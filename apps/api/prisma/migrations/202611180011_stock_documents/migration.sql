CREATE TABLE "StockDocument" (
 "id" UUID PRIMARY KEY, "number" BIGSERIAL UNIQUE NOT NULL,
 "type" TEXT NOT NULL CHECK ("type" IN ('TRANSFER','DAMAGE','ADJUSTMENT')),
 "sourceId" UUID NOT NULL REFERENCES "StockLocation"("id"),
 "destinationId" UUID REFERENCES "StockLocation"("id"),
 "reason" TEXT NOT NULL, "totalCost" DECIMAL(18,2) NOT NULL,
 "createdBy" UUID NOT NULL REFERENCES "User"("id"), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("type"='TRANSFER' AND "destinationId" IS NOT NULL AND "destinationId"<>"sourceId") OR ("type"<>'TRANSFER' AND "destinationId" IS NULL))
);
CREATE INDEX "StockDocument_createdAt_idx" ON "StockDocument"("createdAt");
CREATE TABLE "StockDocumentItem" (
 "id" UUID PRIMARY KEY,"documentId" UUID NOT NULL REFERENCES "StockDocument"("id"),
 "variantId" UUID NOT NULL REFERENCES "ProductVariant"("id"), "name" TEXT NOT NULL,"sku" TEXT NOT NULL,
 "quantity" INTEGER NOT NULL CHECK ("quantity"<>0), "unitCost" DECIMAL(18,4) NOT NULL CHECK ("unitCost">=0),
 UNIQUE("documentId","variantId")
);
CREATE TRIGGER stock_document_immutable BEFORE UPDATE OR DELETE ON "StockDocument" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER stock_document_item_immutable BEFORE UPDATE OR DELETE ON "StockDocumentItem" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
