import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/discount-approvals.controller.js";

export const discountApprovals = Router();

discountApprovals.post(
  "/discount-approvals",
  can("sales.create"),
  controllers.handlePostDiscountApprovals,
);

discountApprovals.get(
  "/discount-approvals",
  can("sales.create", "sales.discount_approve"),
  controllers.handleGetDiscountApprovals,
);

discountApprovals.get(
  "/discount-approvals/:id",
  can("sales.create", "sales.discount_approve"),
  controllers.handleGetDiscountApprovalsById,
);

discountApprovals.post(
  "/discount-approvals/:id/decision",
  can("sales.discount_approve"),
  controllers.handlePostDiscountApprovalsByIdDecision,
);
