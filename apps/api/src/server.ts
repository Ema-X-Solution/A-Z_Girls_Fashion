import app from "./app.js";
import { db } from "./db.js";
import { permissions } from "@az/shared";
if (!process.env.DATABASE_URL || !process.env.APP_ORIGIN)
  throw new Error("DATABASE_URL and APP_ORIGIN are required");
const server = app.listen(Number(process.env.PORT ?? 3001), "0.0.0.0", () =>
  console.log("A&Z API listening"),
);
void db.permission
  .createMany({ data: permissions.map((key) => ({ key })), skipDuplicates: true })
  .catch((error) => console.error("Permission catalog sync failed", error));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(() => {
      void db.$disconnect().then(() => process.exit(0));
    });
  });
