ALTER TABLE "SaleItem" ADD COLUMN "refundedTax" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "SaleReturnItem" ADD COLUMN tax DECIMAL(18,2) NOT NULL DEFAULT 0;
WITH cumulative AS (
 SELECT i.id,i."saleItemId",r."createdAt",r.id AS "returnOrder",s.total,s.tax,
 SUM(i.amount) OVER(PARTITION BY i."saleItemId" ORDER BY r."createdAt",r.id,i.id ROWS UNBOUNDED PRECEDING) AS cumulative_amount
 FROM "SaleReturnItem" i JOIN "SaleReturn" r ON r.id=i."returnId" JOIN "SaleItem" s ON s.id=i."saleItemId"
), allocated AS (
 SELECT *,CASE WHEN total=0 THEN 0 ELSE ROUND(cumulative_amount*tax/total,2) END AS cumulative_tax FROM cumulative
), deltas AS (
 SELECT id,cumulative_tax-COALESCE(LAG(cumulative_tax) OVER(PARTITION BY "saleItemId" ORDER BY "createdAt","returnOrder",id),0) AS tax_delta FROM allocated
)
UPDATE "SaleReturnItem" i SET tax=d.tax_delta FROM deltas d WHERE d.id=i.id;
UPDATE "SaleItem" s SET "refundedTax"=COALESCE((SELECT SUM(i.tax) FROM "SaleReturnItem" i WHERE i."saleItemId"=s.id),0);
ALTER TABLE "SaleItem" ADD CONSTRAINT "refunded_tax_bounds" CHECK("refundedTax">=0 AND "refundedTax"<=tax);
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "return_tax_bounds" CHECK(tax>=0 AND tax<=amount);
CREATE TRIGGER "sale_return_item_immutable" BEFORE UPDATE OR DELETE ON "SaleReturnItem" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
