ALTER TABLE "Sale" ADD COLUMN "operatorId" UUID;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Sale_operatorId_createdAt_idx" ON "Sale"("operatorId", "createdAt");
-- Add the fixed Arabic role only when it does not already exist. Never alter
-- an existing role's permissions or assign/reassign users during deployment.
WITH created AS (
 INSERT INTO "Role" (id,name,protected) VALUES (gen_random_uuid(),'كاشير',false)
 ON CONFLICT (name) DO NOTHING RETURNING id
)
INSERT INTO "RolePermission" ("roleId","permissionKey")
SELECT created.id,rp."permissionKey" FROM created CROSS JOIN "Role" source
JOIN "RolePermission" rp ON rp."roleId"=source.id WHERE source.name='CASHIER'
ON CONFLICT DO NOTHING;
