-- Support customer purchase/return history without changing historical documents.
CREATE INDEX "Sale_customerId_createdAt_idx" ON "Sale"("customerId", "createdAt");
CREATE INDEX "SaleReturn_saleId_createdAt_idx" ON "SaleReturn"("saleId", "createdAt");
