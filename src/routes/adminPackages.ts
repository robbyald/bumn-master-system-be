import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { examPackage, packageFeature } from "../db/schema.js";
import { and, eq, like, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const router = Router();

const listSchema = z.object({
  search: z.string().optional(),
  type: z.enum(["tryout", "learning"]).optional(),
  educationLevel: z.enum(["ALL", "SMA", "D3-S2"]).optional()
});

router.get("/", async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid query", issues: parsed.error.issues });
  }

  const { search, type, educationLevel } = parsed.data;
  const conditions: any[] = [];
  if (search) {
    const term = `%${search}%`;
    conditions.push(or(like(examPackage.title, term), like(examPackage.description, term)) as any);
  }
  if (type) {
    conditions.push(eq(examPackage.type, type) as any);
  }
  if (educationLevel) {
    conditions.push(eq(examPackage.educationLevel, educationLevel) as any);
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
  const offset = Math.max(Number(req.query.offset || 0), 0);

  const rows = await db
    .select({
      id: examPackage.id,
      title: examPackage.title,
      description: examPackage.description,
      price: examPackage.price,
      durationMinutes: examPackage.durationMinutes,
      categories: examPackage.categories,
      totalQuestions: examPackage.totalQuestions,
      type: examPackage.type,
      isPopular: examPackage.isPopular,
      educationLevel: examPackage.educationLevel,
      createdAt: examPackage.createdAt,
      updatedAt: examPackage.updatedAt
    })
    .from(examPackage)
    .where(where)
    .orderBy(sql`${examPackage.createdAt} desc`)
    .limit(limit)
    .offset(offset);

  const data = rows.map((r) => ({
    ...r,
    categories: JSON.parse(r.categories)
  }));

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(examPackage)
    .where(where);

  return res.json({ data, total: total[0]?.count ?? 0, limit, offset });
});

const packageSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  price: z.number().int().min(0),
  durationMinutes: z.number().int().min(0),
  categories: z.array(z.string().min(1)),
  totalQuestions: z.number().int().min(0),
  type: z.enum(["tryout", "learning"]),
  isPopular: z.boolean().optional().default(false),
  educationLevel: z.enum(["ALL", "SMA", "D3-S2"])
});

router.post("/", async (req, res) => {
  const parsed = packageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }

  const body = parsed.data;
  let id = body.id;
  if (!id) {
    // Generate PKG-XXXXX id
    for (let i = 0; i < 5; i++) {
      const rand = Math.floor(Math.random() * 100000).toString().padStart(5, "0");
      const candidate = `PKG-${rand}`;
      const exists = await db.select({ id: examPackage.id }).from(examPackage).where(eq(examPackage.id, candidate)).limit(1);
      if (exists.length === 0) {
        id = candidate;
        break;
      }
    }
  }
  if (!id) {
    return res.status(500).json({ message: "Failed to generate package id" });
  }

  await db
    .insert(examPackage)
    .values({
      id,
      title: body.title,
      description: body.description,
      price: body.price,
      durationMinutes: body.durationMinutes,
      categories: JSON.stringify(body.categories),
      totalQuestions: body.totalQuestions,
      type: body.type,
      isPopular: body.isPopular,
      educationLevel: body.educationLevel
    });

  return res.status(201).json({ ok: true, id });
});

const updateSchema = packageSchema.partial().extend({
  id: z.string().min(1)
});

router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const parsed = updateSchema.safeParse({ ...req.body, id });
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }

  const body = parsed.data;
  await db
    .update(examPackage)
    .set({
      title: body.title,
      description: body.description,
      price: body.price,
      durationMinutes: body.durationMinutes,
      categories: body.categories ? JSON.stringify(body.categories) : undefined,
      totalQuestions: body.totalQuestions,
      type: body.type,
      isPopular: body.isPopular,
      educationLevel: body.educationLevel
    })
    .where(eq(examPackage.id, id));

  return res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  await db.delete(packageFeature).where(eq(packageFeature.packageId, id));
  await db.delete(examPackage).where(eq(examPackage.id, id));
  return res.json({ ok: true });
});

router.get("/:id/features", async (req, res) => {
  const { id } = req.params;
  const rows = await db
    .select({ featureCode: packageFeature.featureCode })
    .from(packageFeature)
    .where(eq(packageFeature.packageId, id));
  return res.json({ featureCodes: rows.map((r) => r.featureCode) });
});

router.put("/:id/features", async (req, res) => {
  const { id } = req.params;
  const schema = z.object({ featureCodes: z.array(z.string().min(1)) });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }
  const featureCodes = Array.from(new Set(parsed.data.featureCodes));

  db.transaction((tx) => {
    tx.delete(packageFeature).where(eq(packageFeature.packageId, id)).run();
    if (featureCodes.length) {
      const values = featureCodes.map((code) => ({
        id: randomUUID(),
        packageId: id,
        featureCode: code,
      }));
      tx.insert(packageFeature).values(values).run();
    }
  });

  return res.json({ ok: true });
});

export default router;
