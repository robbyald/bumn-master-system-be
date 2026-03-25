import { Router } from "express";
import { db } from "../db/index.js";
import { latsolProgress, latsolSet, latsolSetQuestion, questionBank, userPointHistory, userProfile, questionUsage, packageFeature, userPackage } from "../db/schema.js";
import { eq, and, sql, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { auth } from "../auth.js";
import { fromNodeHeaders } from "better-auth/node";
const router = Router();
router.get("/sets", async (req, res) => {
    const categoryId = (req.query.categoryId || "").toString().trim();
    if (!categoryId) {
        return res.status(400).json({ message: "categoryId is required" });
    }
    const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
    });
    if (!session || !session.user) {
        const rows = await db
            .select()
            .from(latsolSet)
            .where(and(eq(latsolSet.categoryId, categoryId), eq(latsolSet.isPublished, true)))
            .orderBy(latsolSet.title);
        const mapped = rows.map((r) => ({
            ...r,
            isCompleted: false,
            isAccessible: !r.isPremium,
        }));
        return res.json({ sets: mapped });
    }
    const featureRows = await db
        .select({ featureCode: packageFeature.featureCode })
        .from(packageFeature)
        .innerJoin(userPackage, eq(userPackage.packageId, packageFeature.packageId))
        .where(eq(userPackage.userId, session.user.id));
    const featureSet = new Set(featureRows.map((r) => r.featureCode));
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
        featureCode: latsolSet.featureCode,
        score: latsolProgress.score,
        attempts: latsolProgress.attempts,
        lastAttemptAt: latsolProgress.lastAttemptAt,
        completedAt: latsolProgress.completedAt,
    })
        .from(latsolSet)
        .leftJoin(latsolProgress, and(eq(latsolProgress.setId, latsolSet.id), eq(latsolProgress.userId, session.user.id)))
        .where(and(eq(latsolSet.categoryId, categoryId), eq(latsolSet.isPublished, true)))
        .orderBy(latsolSet.title);
    const mapped = rows.map((r) => ({
        ...r,
        isCompleted: !!r.completedAt,
        isAccessible: !r.isPremium || (r.featureCode ? featureSet.has(r.featureCode) : false),
    }));
    return res.json({ sets: mapped });
});
router.post("/sets/:id/start", async (req, res) => {
    const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
    });
    if (!session || !session.user) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    const setId = req.params.id;
    const setRows = await db
        .select()
        .from(latsolSet)
        .where(and(eq(latsolSet.id, setId), eq(latsolSet.isPublished, true)))
        .limit(1);
    const set = setRows[0];
    if (!set) {
        return res.status(404).json({ message: "Set not found" });
    }
    if (set.isPremium) {
        const featureRows = await db
            .select({ featureCode: packageFeature.featureCode })
            .from(packageFeature)
            .innerJoin(userPackage, eq(userPackage.packageId, packageFeature.packageId))
            .where(eq(userPackage.userId, session.user.id));
        const featureSet = new Set(featureRows.map((r) => r.featureCode));
        if (!set.featureCode || !featureSet.has(set.featureCode)) {
            return res.status(403).json({ message: "Anda tidak memiliki akses ke set ini." });
        }
    }
    const rows = await db
        .select({
        questionId: latsolSetQuestion.questionId,
        order: latsolSetQuestion.order,
    })
        .from(latsolSetQuestion)
        .where(eq(latsolSetQuestion.setId, setId));
    const questionIds = rows.map((r) => r.questionId);
    if (questionIds.length === 0) {
        return res.status(400).json({ message: "Set has no questions" });
    }
    const questionsRaw = await db
        .select({
        id: questionBank.id,
        category: questionBank.category,
        subcategory: questionBank.subcategory,
        question: questionBank.question,
        options: questionBank.options,
        difficulty: questionBank.difficulty,
    })
        .from(questionBank)
        .where(inArray(questionBank.id, questionIds));
    const questions = questionsRaw.map((q) => {
        const optionsArr = JSON.parse(q.options || "[]");
        const options = optionsArr.map((text, idx) => ({
            id: String.fromCharCode(97 + idx),
            text,
        }));
        return {
            id: q.id,
            category: q.subcategory || q.category,
            content: q.question,
            options,
            difficulty: q.difficulty,
        };
    });
    // Shuffle questions to reduce cheating while keeping set fixed
    for (let i = questions.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const qi = questions[i];
        const qj = questions[j];
        if (!qi || !qj)
            continue;
        questions[i] = qj;
        questions[j] = qi;
    }
    // Track usage for each question in this set (for analytics)
    const userId = session?.user?.id || null;
    for (const q of questions) {
        await db.insert(questionUsage).values({
            id: randomUUID(),
            questionId: q.id,
            setId,
            userId,
        });
    }
    return res.json({
        set: {
            id: set.id,
            title: set.title,
            totalQuestions: set.totalQuestions,
            durationMinutes: set.durationMinutes,
        },
        questions,
    });
});
router.post("/sets/:id/submit", async (req, res) => {
    const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
    });
    if (!session || !session.user) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    const setId = req.params.id;
    const { answers } = req.body || {};
    if (!answers || typeof answers !== "object") {
        return res.status(400).json({ message: "answers is required" });
    }
    const setRows = await db
        .select()
        .from(latsolSet)
        .where(and(eq(latsolSet.id, setId), eq(latsolSet.isPublished, true)))
        .limit(1);
    const set = setRows[0];
    if (!set) {
        return res.status(404).json({ message: "Set not found" });
    }
    if (set.isPremium) {
        const featureRows = await db
            .select({ featureCode: packageFeature.featureCode })
            .from(packageFeature)
            .innerJoin(userPackage, eq(userPackage.packageId, packageFeature.packageId))
            .where(eq(userPackage.userId, session.user.id));
        const featureSet = new Set(featureRows.map((r) => r.featureCode));
        if (!set.featureCode || !featureSet.has(set.featureCode)) {
            return res.status(403).json({ message: "Anda tidak memiliki akses ke set ini." });
        }
    }
    const rows = await db
        .select({
        questionId: latsolSetQuestion.questionId,
    })
        .from(latsolSetQuestion)
        .where(eq(latsolSetQuestion.setId, setId));
    const questionIds = rows.map((r) => r.questionId);
    if (questionIds.length === 0) {
        return res.status(400).json({ message: "Set has no questions" });
    }
    const questionsRaw = await db
        .select({
        id: questionBank.id,
        correctAnswer: questionBank.correctAnswer,
        explanation: questionBank.explanation,
    })
        .from(questionBank)
        .where(inArray(questionBank.id, questionIds));
    let totalCorrect = 0;
    const graded = questionsRaw.map((q) => {
        const normalizedCorrect = (q.correctAnswer || "").trim().toLowerCase();
        const given = typeof answers[q.id] === "string" ? answers[q.id].toLowerCase() : "";
        const isCorrect = given && normalizedCorrect && given === normalizedCorrect;
        if (isCorrect)
            totalCorrect += 1;
        return {
            id: q.id,
            correctAnswer: normalizedCorrect,
            explanation: q.explanation || "",
            isCorrect,
        };
    });
    const score = questionIds.length
        ? Math.round((totalCorrect / questionIds.length) * 100)
        : 0;
    const existing = await db
        .select()
        .from(latsolProgress)
        .where(and(eq(latsolProgress.setId, setId), eq(latsolProgress.userId, session.user.id)))
        .limit(1);
    const now = new Date();
    let pointsEarned = 0;
    if (existing.length === 0) {
        const percent = questionIds.length ? (totalCorrect / questionIds.length) * 100 : 0;
        if (percent >= 90)
            pointsEarned = 50;
        else if (percent >= 70)
            pointsEarned = 30;
        else if (percent >= 50)
            pointsEarned = 10;
        else
            pointsEarned = 2;
    }
    if (existing.length > 0) {
        await db
            .update(latsolProgress)
            .set({
            score,
            attempts: sql `${latsolProgress.attempts} + 1`,
            lastAttemptAt: now,
            completedAt: now,
        })
            .where(eq(latsolProgress.id, existing[0].id));
    }
    else {
        await db.insert(latsolProgress).values({
            id: randomUUID(),
            userId: session.user.id,
            setId,
            categoryId: set.categoryId,
            score,
            attempts: 1,
            lastAttemptAt: now,
        });
    }
    if (pointsEarned > 0) {
        await db
            .update(userProfile)
            .set({ points: sql `${userProfile.points} + ${pointsEarned}` })
            .where(eq(userProfile.userId, session.user.id));
        await db.insert(userPointHistory).values({
            id: randomUUID(),
            userId: session.user.id,
            amount: pointsEarned,
            type: "earn",
            description: `Reward Latihan Soal: ${set.title}`,
        });
    }
    return res.json({
        score,
        totalCorrect,
        totalQuestions: questionIds.length,
        pointsEarned,
        attempts: existing.length > 0 ? (existing[0].attempts || 0) + 1 : 1,
        questions: graded,
    });
});
router.get("/progress/summary", async (req, res) => {
    const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
    });
    if (!session || !session.user) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    const rows = await db
        .select({
        categoryId: latsolSet.categoryId,
        completed: sql `count(${latsolProgress.id})`,
    })
        .from(latsolProgress)
        .leftJoin(latsolSet, eq(latsolProgress.setId, latsolSet.id))
        .where(eq(latsolProgress.userId, session.user.id))
        .groupBy(latsolSet.categoryId);
    return res.json({ summary: rows });
});
router.post("/progress", async (req, res) => {
    const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
    });
    if (!session || !session.user) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    const { setId, score } = req.body || {};
    if (!setId) {
        return res.status(400).json({ message: "setId is required" });
    }
    const setRows = await db.select().from(latsolSet).where(eq(latsolSet.id, setId)).limit(1);
    const set = setRows[0];
    if (!set) {
        return res.status(404).json({ message: "Set not found" });
    }
    const existing = await db
        .select()
        .from(latsolProgress)
        .where(and(eq(latsolProgress.setId, setId), eq(latsolProgress.userId, session.user.id)))
        .limit(1);
    const now = new Date();
    if (existing.length > 0) {
        await db
            .update(latsolProgress)
            .set({
            score: typeof score === "number" ? score : null,
            attempts: sql `${latsolProgress.attempts} + 1`,
            lastAttemptAt: now,
            completedAt: now,
        })
            .where(eq(latsolProgress.id, existing[0].id));
    }
    else {
        await db.insert(latsolProgress).values({
            id: randomUUID(),
            userId: session.user.id,
            setId,
            categoryId: set.categoryId,
            score: typeof score === "number" ? score : null,
            attempts: 1,
            lastAttemptAt: now,
        });
    }
    return res.json({ ok: true });
});
export default router;
