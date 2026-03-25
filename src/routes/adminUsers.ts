import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { user, userProfile, userPackage, userPointHistory } from "../db/schema.js";
import { and, eq, like, or, sql } from "drizzle-orm";
import { auth } from "../auth.js";
import { isAPIError } from "better-auth/api";

const router = Router();

const listQuerySchema = z.object({
  search: z.string().optional(),
  role: z.enum(["admin", "user"]).optional(),
  status: z.enum(["active", "blocked"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

router.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid query", issues: parsed.error.issues });
  }

  const { search, role, status, limit = 50, offset = 0 } = parsed.data;

  const conditions: any[] = [];

  if (search) {
    const term = `%${search}%`;
    conditions.push(or(like(user.name, term), like(user.email, term)) as any);
  }

  if (role) {
    conditions.push(
      sql`coalesce(${userProfile.role}, 'user') = ${role}` as any
    );
  }

  if (status) {
    conditions.push(
      sql`coalesce(${userProfile.status}, 'active') = ${status}` as any
    );
  }

  const whereClause = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      role: userProfile.role,
      status: userProfile.status,
      targetBumn: userProfile.targetBumn,
      phone: userProfile.phone,
      points: userProfile.points
    })
    .from(user)
    .leftJoin(userProfile, eq(user.id, userProfile.userId))
    .where(whereClause)
    .limit(limit)
    .offset(offset)
    .orderBy(sql`${user.createdAt} desc`);

  const data = rows.map(r => ({
    id: r.id,
    name: r.name,
    email: r.email,
    image: r.image,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    role: r.role ?? "user",
    status: r.status ?? "active",
    targetBumn: r.targetBumn ?? null,
    phone: r.phone ?? null,
    points: r.points ?? 0
  }));

  return res.json({ data, limit, offset });
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      role: userProfile.role,
      status: userProfile.status,
      targetBumn: userProfile.targetBumn,
      phone: userProfile.phone,
      points: userProfile.points
    })
    .from(user)
    .leftJoin(userProfile, eq(user.id, userProfile.userId))
    .where(eq(user.id, id))
    .limit(1);

  if (rows.length === 0) {
    return res.status(404).json({ message: "User not found" });
  }

  const r = rows[0]!;
  return res.json({
    id: r.id,
    name: r.name,
    email: r.email,
    image: r.image,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    role: r.role ?? "user",
    status: r.status ?? "active",
    targetBumn: r.targetBumn ?? null,
    phone: r.phone ?? null,
    points: r.points ?? 0
  });
});

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "user"]).default("user"),
  status: z.enum(["active", "blocked"]).default("active"),
  targetBumn: z.string().min(1).optional().nullable(),
  phone: z.string().min(6).optional().nullable(),
  points: z.number().int().min(0).optional(),
  packageIds: z.array(z.string().min(1)).optional()
});

router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }

  const { name, email, password, role, status, targetBumn, phone, points, packageIds } = parsed.data;

  try {
    const result = await auth.api.signUpEmail({
      body: { name, email, password }
    });

    const userId = result.user.id;

    await db
      .insert(userProfile)
      .values({
        userId,
        role,
        status,
        targetBumn: targetBumn ?? null,
        phone: phone ?? null,
        points: points ?? 0
      })
      .onConflictDoUpdate({
        target: userProfile.userId,
        set: {
          role,
          status,
          targetBumn: targetBumn ?? sql`${userProfile.targetBumn}`,
          phone: phone ?? sql`${userProfile.phone}`,
          points: points ?? sql`${userProfile.points}`
        }
      });

    if (packageIds && packageIds.length > 0) {
      const values = packageIds.map((pkgId) => ({
        userId,
        packageId: pkgId
      }));
      await db.insert(userPackage).values(values);
    }

    return res.status(201).json({ id: userId, email, name, role, status });
  } catch (err) {
    if (isAPIError(err)) {
      return res.status(400).json({ message: err.message });
    }
    return res.status(500).json({ message: "Server error" });
  }
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["admin", "user"]).optional(),
  status: z.enum(["active", "blocked"]).optional(),
  targetBumn: z.string().min(1).optional().nullable(),
  phone: z.string().min(6).optional().nullable(),
  points: z.number().int().min(0).optional()
});

router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }

  const existing = await db.select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1);
  if (existing.length === 0) {
    return res.status(404).json({ message: "User not found" });
  }

  const { name, role, status, targetBumn, phone, points } = parsed.data;

  if (name) {
    await db.update(user).set({ name }).where(eq(user.id, id));
  }

  if (role || status || targetBumn !== undefined || phone !== undefined || points !== undefined) {
    await db
      .insert(userProfile)
      .values({
        userId: id,
        role: role ?? "user",
        status: status ?? "active",
        targetBumn: targetBumn ?? null,
        phone: phone ?? null,
        points: points ?? 0
      })
      .onConflictDoUpdate({
        target: userProfile.userId,
        set: {
          role: role ?? sql`${userProfile.role}`,
          status: status ?? sql`${userProfile.status}`,
          targetBumn: targetBumn ?? sql`${userProfile.targetBumn}`,
          phone: phone ?? sql`${userProfile.phone}`,
          points: points ?? sql`${userProfile.points}`
        }
      });
  }

  return res.json({ ok: true });
});

const statusSchema = z.object({
  status: z.enum(["active", "blocked"])
});

router.post("/:id/status", async (req, res) => {
  const { id } = req.params;
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }

  const existing = await db.select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1);
  if (existing.length === 0) {
    return res.status(404).json({ message: "User not found" });
  }

  await db
    .insert(userProfile)
    .values({ userId: id, status: parsed.data.status })
    .onConflictDoUpdate({
      target: userProfile.userId,
      set: { status: parsed.data.status }
    });

  return res.json({ ok: true });
});

const pointsSchema = z.object({
  delta: z.number().int(),
  reason: z.string().min(1).optional()
});

router.post("/:id/points", async (req, res) => {
  const { id } = req.params;
  const parsed = pointsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }

  const existing = await db.select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1);
  if (existing.length === 0) {
    return res.status(404).json({ message: "User not found" });
  }

  const profile = await db
    .select({ points: userProfile.points })
    .from(userProfile)
    .where(eq(userProfile.userId, id))
    .limit(1);

  const current = profile[0]?.points ?? 0;
  const next = Math.max(0, current + parsed.data.delta);

  await db
    .insert(userProfile)
    .values({ userId: id, points: next })
    .onConflictDoUpdate({
      target: userProfile.userId,
      set: { points: next }
    });

  const reason = parsed.data.reason?.trim();
  const amount = Math.abs(parsed.data.delta);
  if (amount > 0) {
    await db.insert(userPointHistory).values({
      id: `ph_${Date.now()}`,
      userId: id,
      amount,
      type: parsed.data.delta >= 0 ? "earn" : "spend",
      description: reason || "Penyesuaian poin oleh admin"
    });
  }

  return res.json({ ok: true, points: next });
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const actorId = res.locals.user?.id;
  if (actorId && actorId === id) {
    return res.status(400).json({ message: "Tidak dapat menghapus akun sendiri." });
  }
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1);
  if (existing.length === 0) {
    return res.status(404).json({ message: "User not found" });
  }

  await db.delete(user).where(eq(user.id, id));
  return res.json({ ok: true });
});

router.get("/:id/points", async (req, res) => {
  const { id } = req.params;
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1);
  if (existing.length === 0) {
    return res.status(404).json({ message: "User not found" });
  }

  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const start = req.query.start ? new Date(String(req.query.start)) : null;
  const end = req.query.end ? new Date(String(req.query.end)) : null;

  const conditions: any[] = [eq(userPointHistory.userId, id)];
  if (start && !isNaN(start.getTime())) {
    conditions.push(sql`${userPointHistory.createdAt} >= ${start.getTime()}`);
  }
  if (end && !isNaN(end.getTime())) {
    const endOfDay = new Date(end);
    endOfDay.setHours(23, 59, 59, 999);
    conditions.push(sql`${userPointHistory.createdAt} <= ${endOfDay.getTime()}`);
  }

  const whereClause = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: userPointHistory.id,
      amount: userPointHistory.amount,
      type: userPointHistory.type,
      description: userPointHistory.description,
      createdAt: userPointHistory.createdAt
    })
    .from(userPointHistory)
    .where(whereClause)
    .orderBy(sql`${userPointHistory.createdAt} desc`)
    .limit(limit)
    .offset(offset);

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(userPointHistory)
    .where(whereClause);

  return res.json({ data: rows, total: total[0]?.count ?? 0, limit, offset });
});

export default router;
