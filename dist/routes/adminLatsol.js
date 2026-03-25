import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { latsolSet, latsolSetQuestion, questionBank } from "../db/schema.js";
import { and, eq, like, sql } from "drizzle-orm";
const router = Router();
router.get("/sets", async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 10)));
    const offset = (page - 1) * limit;
    const conditions = [];
    const categoryId = String(req.query.categoryId || "").trim();
    const category = String(req.query.category || "").trim();
    const subcategory = String(req.query.subcategory || "").trim();
    const q = String(req.query.q || "").trim();
    if (categoryId)
        conditions.push(eq(latsolSet.categoryId, categoryId));
    if (category)
        conditions.push(eq(latsolSet.category, category));
    if (subcategory)
        conditions.push(eq(latsolSet.subcategory, subcategory));
    if (q)
        conditions.push(like(latsolSet.title, `%${q}%`));
    const whereClause = conditions.length ? and(...conditions) : undefined;
    const totalRows = await db
        .select({ count: sql `count(${latsolSet.id})` })
        .from(latsolSet)
        .where(whereClause);
    const total = totalRows[0]?.count || 0;
    const rows = await db
        .select({
        id: latsolSet.id,
        categoryId: latsolSet.categoryId,
        category: latsolSet.category,
        subcategory: latsolSet.subcategory,
        title: latsolSet.title,
        totalQuestions: latsolSet.totalQuestions,
        durationMinutes: latsolSet.durationMinutes,
        isPremium: latsolSet.isPremium,
        isPublished: latsolSet.isPublished,
        featureCode: latsolSet.featureCode,
        createdAt: latsolSet.createdAt,
        updatedAt: latsolSet.updatedAt,
        questionCount: sql `count(${latsolSetQuestion.id})`,
    })
        .from(latsolSet)
        .leftJoin(latsolSetQuestion, eq(latsolSetQuestion.setId, latsolSet.id))
        .where(whereClause)
        .groupBy(latsolSet.id)
        .orderBy(sql `created_at desc`)
        .limit(limit)
        .offset(offset);
    return res.json({ items: rows, total, page, limit });
});
router.get("/sets/:id", async (req, res) => {
    const id = req.params.id;
    const sets = await db.select().from(latsolSet).where(eq(latsolSet.id, id)).limit(1);
    if (!sets.length)
        return res.status(404).json({ message: "Set not found" });
    const questions = await db
        .select({
        id: questionBank.id,
        question: questionBank.question,
        difficulty: questionBank.difficulty,
        status: questionBank.status,
        subcategory: questionBank.subcategory,
        order: latsolSetQuestion.order,
    })
        .from(latsolSetQuestion)
        .innerJoin(questionBank, eq(latsolSetQuestion.questionId, questionBank.id))
        .where(eq(latsolSetQuestion.setId, id))
        .orderBy(latsolSetQuestion.order);
    return res.json({ set: sets[0], questions });
});
router.post("/sets", async (req, res) => {
    const schema = z.object({
        categoryId: z.string().min(1),
        category: z.string().min(1),
        subcategory: z.string().min(1),
        title: z.string().min(1),
        totalQuestions: z.number().int().min(1),
        durationMinutes: z.number().int().min(1).default(60),
        isPremium: z.boolean().optional().default(false),
        isPublished: z.boolean().optional().default(false),
        featureCode: z.string().min(1).optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    const id = randomUUID();
    const featureCode = parsed.data.featureCode && parsed.data.featureCode.trim()
        ? parsed.data.featureCode.trim()
        : `SET_${id.slice(0, 8).toUpperCase()}`;
    await db.insert(latsolSet).values({ id, ...parsed.data, featureCode });
    return res.status(201).json({ id, featureCode });
});
router.patch("/sets/:id", async (req, res) => {
    const id = req.params.id;
    const schema = z.object({
        categoryId: z.string().min(1).optional(),
        category: z.string().min(1).optional(),
        subcategory: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
        totalQuestions: z.number().int().min(1).optional(),
        durationMinutes: z.number().int().min(1).optional(),
        isPremium: z.boolean().optional(),
        isPublished: z.boolean().optional(),
        featureCode: z.string().min(1).optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    await db.update(latsolSet).set(parsed.data).where(eq(latsolSet.id, id));
    const rows = await db.select().from(latsolSet).where(eq(latsolSet.id, id)).limit(1);
    return res.json({ set: rows[0] });
});
router.delete("/sets/:id", async (req, res) => {
    const id = req.params.id;
    await db.delete(latsolSetQuestion).where(eq(latsolSetQuestion.setId, id));
    await db.delete(latsolSet).where(eq(latsolSet.id, id));
    return res.json({ ok: true });
});
router.put("/sets/:id/questions", async (req, res) => {
    const id = req.params.id;
    const schema = z.object({
        questionIds: z.array(z.string().min(1)),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    const sets = await db.select().from(latsolSet).where(eq(latsolSet.id, id)).limit(1);
    if (!sets.length)
        return res.status(404).json({ message: "Set not found" });
    const set = sets[0];
    if (parsed.data.questionIds.length !== set.totalQuestions) {
        return res.status(400).json({ message: `Jumlah soal harus ${set.totalQuestions}.` });
    }
    db.transaction((tx) => {
        tx.delete(latsolSetQuestion).where(eq(latsolSetQuestion.setId, id)).run();
        const values = parsed.data.questionIds.map((qid, idx) => ({
            id: randomUUID(),
            setId: id,
            questionId: qid,
            order: idx + 1,
        }));
        if (values.length) {
            tx.insert(latsolSetQuestion).values(values).run();
        }
    });
    return res.json({ ok: true });
});
router.post("/sets/:id/autofill", async (req, res) => {
    const id = req.params.id;
    const sets = await db.select().from(latsolSet).where(eq(latsolSet.id, id)).limit(1);
    if (!sets.length)
        return res.status(404).json({ message: "Set not found" });
    const set = sets[0];
    const candidates = await db
        .select({
        id: questionBank.id,
    })
        .from(questionBank)
        .leftJoin(latsolSetQuestion, eq(latsolSetQuestion.questionId, questionBank.id))
        .where(and(eq(questionBank.category, set.category), eq(questionBank.subcategory, set.subcategory), eq(questionBank.status, "approved"), sql `${latsolSetQuestion.questionId} IS NULL`))
        .orderBy(sql `RANDOM()`)
        .limit(set.totalQuestions);
    if (candidates.length < set.totalQuestions) {
        return res.status(400).json({
            message: `Soal approved yang belum terpakai tidak cukup. Tersedia ${candidates.length} dari ${set.totalQuestions}.`,
        });
    }
    db.transaction((tx) => {
        tx.delete(latsolSetQuestion).where(eq(latsolSetQuestion.setId, id)).run();
        const values = candidates.map((q, idx) => ({
            id: randomUUID(),
            setId: id,
            questionId: q.id,
            order: idx + 1,
        }));
        if (values.length) {
            tx.insert(latsolSetQuestion).values(values).run();
        }
    });
    return res.json({ ok: true });
});
export default router;
