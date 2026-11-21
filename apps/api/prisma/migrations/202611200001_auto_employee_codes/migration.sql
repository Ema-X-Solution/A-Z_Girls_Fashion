UPDATE "User"
SET "employeeCode" = UPPER(LEFT("id"::text, 8))
WHERE "employeeCode" IS NULL OR "employeeCode" = '';
