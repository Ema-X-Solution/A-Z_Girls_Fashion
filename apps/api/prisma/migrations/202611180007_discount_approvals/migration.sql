CREATE TABLE "DiscountApproval" (
 "id" UUID PRIMARY KEY, "requesterId" UUID NOT NULL REFERENCES "User"("id"),
 "shiftId" UUID NOT NULL REFERENCES "CashShift"("id"), "input" JSONB NOT NULL,
 "fingerprint" TEXT NOT NULL, "reason" TEXT NOT NULL,
 "subtotal" DECIMAL(18,2) NOT NULL, "discount" DECIMAL(18,2) NOT NULL,
 "total" DECIMAL(18,2) NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
 "approverId" UUID REFERENCES "User"("id"), "decisionNote" TEXT, "decidedAt" TIMESTAMP(3),
 "consumedSaleId" UUID UNIQUE REFERENCES "Sale"("id"),
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("status" IN ('PENDING','APPROVED','REJECTED','CONSUMED')),
 CHECK ("discount">=0 AND "discount"<="subtotal" AND "total">=0),
 CHECK ("approverId" IS NULL OR "approverId"<>"requesterId"),
 CHECK (("status"='PENDING' AND "approverId" IS NULL AND "decidedAt" IS NULL) OR
        ("status"<>'PENDING' AND "approverId" IS NOT NULL AND "decidedAt" IS NOT NULL)),
 CHECK (("status"='CONSUMED')=("consumedSaleId" IS NOT NULL))
);
CREATE INDEX "DiscountApproval_requesterId_createdAt_idx" ON "DiscountApproval"("requesterId","createdAt");
CREATE INDEX "DiscountApproval_status_createdAt_idx" ON "DiscountApproval"("status","createdAt");
INSERT INTO "Permission"("key") VALUES ('sales.discount_approve') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("roleId","permissionKey")
 SELECT "id",'sales.discount_approve' FROM "Role" WHERE "name" IN ('OWNER','MANAGER') ON CONFLICT DO NOTHING;
CREATE FUNCTION protect_discount_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Discount approvals are immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','approverId','decisionNote','decidedAt','consumedSaleId']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','approverId','decisionNote','decidedAt','consumedSaleId']) THEN
   RAISE EXCEPTION 'Approval request snapshot is immutable';
 END IF;
 IF NOT ((OLD."status"='PENDING' AND NEW."status" IN ('APPROVED','REJECTED') AND NEW."consumedSaleId" IS NULL) OR
   (OLD."status"='APPROVED' AND NEW."status"='CONSUMED' AND NEW."approverId"=OLD."approverId"
    AND NEW."decidedAt"=OLD."decidedAt" AND NEW."decisionNote" IS NOT DISTINCT FROM OLD."decisionNote")) THEN
   RAISE EXCEPTION 'Invalid approval transition';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER discount_approval_immutable BEFORE UPDATE OR DELETE ON "DiscountApproval"
 FOR EACH ROW EXECUTE FUNCTION protect_discount_approval();
