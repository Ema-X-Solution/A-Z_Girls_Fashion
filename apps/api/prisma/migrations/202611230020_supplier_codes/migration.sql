-- Preserve supplier IDs, invoices, balances and all relationships.
CREATE SEQUENCE "Supplier_code_seq";
ALTER TABLE "Supplier" ADD COLUMN "code" TEXT;
-- Deterministic order gives every existing supplier a reference, including inactive ones.
WITH numbered AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS n FROM "Supplier"
)
UPDATE "Supplier" s SET "code" = 'SUP-' || lpad(n.n::text, greatest(4, length(n.n::text)), '0')
FROM numbered n WHERE s."id" = n."id";
SELECT setval('"Supplier_code_seq"', greatest((SELECT count(*) FROM "Supplier"), 1), (SELECT count(*) > 0 FROM "Supplier"));
CREATE FUNCTION next_supplier_code() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE candidate TEXT; n BIGINT;
BEGIN
  LOOP
    n := nextval('"Supplier_code_seq"');
    candidate := 'SUP-' || lpad(n::text, greatest(4, length(n::text)), '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM "Supplier" WHERE "code" = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;
ALTER TABLE "Supplier" ALTER COLUMN "code" SET DEFAULT next_supplier_code();
ALTER TABLE "Supplier" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- Existing products remain unassigned: never infer a primary supplier from purchase history.
ALTER TABLE "Product" ADD COLUMN "primarySupplierId" UUID;
ALTER TABLE "Product" ADD CONSTRAINT "Product_primarySupplierId_fkey" FOREIGN KEY ("primarySupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Product_primarySupplierId_status_idx" ON "Product"("primarySupplierId", "status");
