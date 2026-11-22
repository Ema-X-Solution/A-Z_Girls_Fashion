import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/exchanges.controller.js";
export { netExchangeSchema } from "../controllers/exchanges.controller.js";

export const exchanges = Router();

exchanges.post(
  "/sales/:id/exchanges/quote",
  can("sales.refund"),
  can("sales.create"),
  controllers.handlePostSalesByIdExchangesQuote,
);

exchanges.post(
  "/sales/:id/exchanges/net",
  can("sales.refund"),
  can("sales.create"),
  controllers.handlePostSalesByIdExchangesNet,
);

exchanges.get("/exchanges/:id", can("sales.refund"), controllers.handleGetExchangesById);
