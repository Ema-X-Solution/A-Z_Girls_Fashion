import { PrismaClient } from "@prisma/client";
import { hash, argon2id } from "argon2";
import { permissions, roleDefaults,defaultReturnPolicy } from "@az/shared";
const db = new PrismaClient();
try {
  const email = process.env.INITIAL_OWNER_EMAIL?.trim().toLowerCase(),
    password = process.env.INITIAL_OWNER_PASSWORD;
  if (!email || !password || password.length < 8)
    throw new Error(
      "Set INITIAL_OWNER_EMAIL and a unique INITIAL_OWNER_PASSWORD of at least 8 characters",
    );
  const passwordHash = await hash(password, { type: argon2id });
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1029384756)`;
    if (await tx.user.count())
      throw new Error("Initialization refused: users already exist");
    await tx.permission.createMany({
      data: permissions.map((key) => ({ key })),
      skipDuplicates: true,
    });
    for (const [name, keys] of Object.entries(roleDefaults))
      await tx.role.create({
        data: {
          name,
          protected: name === "OWNER",
          permissions: {
            create: keys.map((permissionKey) => ({ permissionKey })),
          },
        },
      });
    const owner = await tx.role.findUniqueOrThrow({ where: { name: "OWNER" } });
    const user = await tx.user.create({
      data: {
        email,
        name: "مالك المتجر",
        passwordHash,
        discountLimit: 100,
        roles: { create: { roleId: owner.id } },
      },
    });
    const branch = await tx.branch.create({ data: { name: "الفرع الرئيسي" } });
    const location = await tx.stockLocation.create({
      data: { branchId: branch.id, name: "المخزن الرئيسي" },
    });
    await tx.register.create({
      data: {
        branchId: branch.id,
        locationId: location.id,
        name: "الكاشير الرئيسي",
      },
    });
    await tx.category.createMany({
      data: ["ملابس", "أحذية", "حقائب", "إكسسوارات"].map((name) => ({ name })),
    });
    await tx.expenseCategory.createMany({data:["إيجار","كهرباء","إنترنت","رواتب","نقل","تغليف","صيانة","تسويق","أخرى"].map(name=>({name})),skipDuplicates:true});
    await tx.systemSetting.create({
      data: {
        key: "store",
        value: {
          name: "A&Z Girls Fashion",
          currency: "EGP",
          timezone: "Africa/Cairo",
          address: "",
          phone: "",
          taxRate: "14",
          taxMode:'INCLUSIVE',invoicePrefix:'INV',branchName:'',taxNumber:'',commercialRegister:'',returnPolicy:defaultReturnPolicy,
          returnDays: 14,
          receiptFooter: "شكراً لزيارتكم",
          receiptWidth: 80,
        },
      },
    });
    await tx.auditLog.create({
      data: { userId: user.id, action: "INITIALIZE", reference: branch.id },
    });
  });
  console.log(
    "Initialization complete. Remove initialization credentials from the environment.",
  );
} finally {
  await db.$disconnect();
}
