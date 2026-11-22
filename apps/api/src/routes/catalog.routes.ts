import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/catalog.controller.js";

export const catalogRouter = Router();

catalogRouter.get(
  "/categories",
  can("products.view"),
  controllers.handleGetCategories,
);

catalogRouter.post(
  "/categories",
  can("products.create"),
  controllers.handlePostCategories,
);

catalogRouter.patch(
  "/categories/:id",
  can("products.update"),
  controllers.handlePatchCategoriesById,
);

catalogRouter.post(
  "/categories/:id/remove",
  can("products.archive"),
  controllers.handlePostCategoriesByIdRemove,
);

catalogRouter.post(
  "/categories/:id/restore",
  can("products.archive"),
  controllers.handlePostCategoriesByIdRestore,
);

catalogRouter.get(
  "/brands",
  can("products.view"),
  controllers.handleGetBrands,
);

catalogRouter.post(
  "/brands",
  can("products.create"),
  controllers.handlePostBrands,
);

catalogRouter.get(
  "/products",
  can("products.view"),
  controllers.handleGetProducts,
);

catalogRouter.post(
  "/products",
  can("products.create"),
  controllers.handlePostProducts,
);

catalogRouter.get(
  "/products/:id",
  can("products.view"),
  controllers.handleGetProductsById,
);

catalogRouter.patch(
  "/products/:id",
  can("products.update"),
  controllers.handlePatchProductsById,
);

catalogRouter.post(
  "/products/:id/archive",
  can("products.archive"),
  controllers.handlePostProductsByIdArchive,
);

catalogRouter.post(
  "/products/:id/restore",
  can("products.archive"),
  controllers.handlePostProductsByIdRestore,
);

catalogRouter.post(
  "/products/:id/variants",
  can("products.create"),
  controllers.handlePostProductsByIdVariants,
);

catalogRouter.patch(
  "/variants/:id",
  can("products.change_price"),
  controllers.handlePatchVariantsById,
);

catalogRouter.get(
  "/barcodes/:code/lookup",
  can("products.view", "pos.access"),
  controllers.handleGetBarcodesByCodeLookup,
);

catalogRouter.post("/barcodes/generate", can("products.create"), controllers.handlePostBarcodesGenerate,
);
