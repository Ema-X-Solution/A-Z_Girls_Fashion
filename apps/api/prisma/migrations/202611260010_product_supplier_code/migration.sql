-- Free-text supplier code typed on the product. Nullable: existing products stay untouched.
ALTER TABLE "Product" ADD COLUMN "supplierCode" TEXT;
CREATE INDEX "Product_supplierCode_idx" ON "Product"("supplierCode");
