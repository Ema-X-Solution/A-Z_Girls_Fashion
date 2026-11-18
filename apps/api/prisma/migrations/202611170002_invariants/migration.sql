-- Database guards supplement application validation and serializable transactions.
CREATE UNIQUE INDEX "one_open_shift_per_register" ON "CashShift" ("registerId") WHERE "closedAt" IS NULL;
CREATE UNIQUE INDEX "one_open_shift_per_user" ON "CashShift" ("userId") WHERE "closedAt" IS NULL;
ALTER TABLE "StockBalance" ADD CONSTRAINT "stock_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "StockBalance" ADD CONSTRAINT "average_cost_nonnegative" CHECK ("averageCost" >= 0);
ALTER TABLE "ProductVariant" ADD CONSTRAINT "variant_prices_nonnegative" CHECK ("price" >= 0 AND "cost" >= 0 AND "minStock" >= 0);
ALTER TABLE "SaleItem" ADD CONSTRAINT "sale_item_quantities" CHECK ("quantity" > 0 AND "returned" >= 0 AND "returned" <= "quantity" AND "refunded" >= 0 AND "refunded" <= "total");
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "purchase_item_quantities" CHECK ("quantity" > 0 AND "received" >= 0 AND "received" <= "quantity" AND "unitCost" >= 0);
ALTER TABLE "User" ADD CONSTRAINT "discount_limit_range" CHECK ("discountLimit" >= 0 AND "discountLimit" <= 100);
ALTER TABLE "SalePayment" ADD CONSTRAINT "payment_nonnegative" CHECK ("amount" >= 0);
CREATE FUNCTION prevent_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Ledger entries are immutable'; END $$;
CREATE TRIGGER "stock_ledger_immutable" BEFORE UPDATE OR DELETE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER "cash_ledger_immutable" BEFORE UPDATE OR DELETE ON "CashMovement" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER "audit_log_immutable" BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
