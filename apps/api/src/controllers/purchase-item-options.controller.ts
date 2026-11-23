import type { RequestHandler } from "express";
import { route } from "../utils/http.js";
import { variantOptions } from "../services/variant-options.js";

export const handlePurchaseItemOptions: RequestHandler = route(
  async (req, res) => res.json(await variantOptions(req)),
);
