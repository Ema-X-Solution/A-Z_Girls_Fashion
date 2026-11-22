import express, { type RequestHandler } from "express";
import { z } from "zod";
import { id } from "@az/shared";
import { actor } from "../../auth.js";

export const route =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

export const uuid = (v: unknown) => id.parse(v);

export function page(query: any) {
  return {
    take: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(30)
      .parse(query.limit),
    skip: z.coerce.number().int().min(0).default(0).parse(query.offset),
  };
}

export const text = z.string().trim().min(1).max(200);

export const hasCosts = (req: express.Request) =>
  actor(req).permissions.includes("reports.profit");
