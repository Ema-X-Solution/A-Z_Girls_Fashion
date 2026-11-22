import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/product-images.controller.js";
export { productImageAsset } from "../controllers/product-images.controller.js";

export const productImages = Router();

productImages.post(
  "/products/:id/image",
  can("products.update"),
  controllers.handlePostProductsByIdImage,
);
