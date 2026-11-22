import { PrismaClient, Prisma } from "@prisma/client";
export const db = new PrismaClient();
export type Tx = Prisma.TransactionClient;
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  code: string,
  message: string,
  status = 409,
): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: "Serializable",
        maxWait: 5000,
        timeout: 15000,
      });
    } catch (e) {
      const retry =
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (["P2034", "P2002"].includes(e.code) ||
          (e.code === "P2010" &&
            ["40001", "40P01"].includes(String(e.meta?.code))));
      if (retry && attempt < 5) continue;
      throw e;
    }
  }
}
export function audit(
  tx: Tx,
  userId: string | null,
  action: string,
  reference: string,
  details: Prisma.InputJsonValue = {},
) {
  return tx.auditLog.create({ data: { userId, action, reference, details } });
}
export function json(value: unknown): any {
  return JSON.parse(
    JSON.stringify(value, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  );
}
