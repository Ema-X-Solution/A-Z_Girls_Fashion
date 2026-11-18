CREATE TABLE "LoyaltyAccount" (
 "customerId" UUID PRIMARY KEY REFERENCES "Customer"("id"), "debt" INTEGER NOT NULL DEFAULT 0 CHECK ("debt">=0)
);
CREATE TABLE "LoyaltyLot" (
 "id" UUID PRIMARY KEY, "customerId" UUID NOT NULL REFERENCES "Customer"("id"),
 "reference" TEXT NOT NULL UNIQUE, "saleId" UUID UNIQUE REFERENCES "Sale"("id"),
 "points" INTEGER NOT NULL CHECK ("points">0), "remaining" INTEGER NOT NULL CHECK ("remaining">=0),
 "expired" INTEGER NOT NULL DEFAULT 0 CHECK ("expired">=0), "reversed" INTEGER NOT NULL DEFAULT 0 CHECK ("reversed">=0),
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("remaining"+"expired"+"reversed"<="points")
);
CREATE INDEX "LoyaltyLot_customerId_expiresAt_idx" ON "LoyaltyLot"("customerId","expiresAt");
CREATE TABLE "LoyaltyRedemption" (
 "id" UUID PRIMARY KEY, "saleId" UUID NOT NULL REFERENCES "Sale"("id"), "lotId" UUID NOT NULL REFERENCES "LoyaltyLot"("id"),
 "points" INTEGER NOT NULL CHECK ("points">0), "restored" INTEGER NOT NULL DEFAULT 0 CHECK ("restored">=0 AND "restored"<="points"),
 UNIQUE("saleId","lotId")
);
CREATE TABLE "LoyaltyEntry" (
 "id" UUID PRIMARY KEY, "customerId" UUID NOT NULL REFERENCES "Customer"("id"), "reference" TEXT NOT NULL UNIQUE,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('EARN','REDEEM','REVERSE','RESTORE','EXPIRE')),
 "points" INTEGER NOT NULL, "saleId" UUID REFERENCES "Sale"("id"), "returnId" UUID REFERENCES "SaleReturn"("id"),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LoyaltyEntry_customerId_createdAt_idx" ON "LoyaltyEntry"("customerId","createdAt");
CREATE TRIGGER loyalty_entry_immutable BEFORE UPDATE OR DELETE ON "LoyaltyEntry" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
