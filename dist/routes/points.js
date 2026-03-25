import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";
import { db } from "../db/index.js";
import { userPointHistory, userProfile } from "../db/schema.js";
import { and, eq, sql } from "drizzle-orm";
const router = Router();
router.get("/me", async (req, res) => {
    const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers)
    });
    if (!session || !session.user) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    const profile = await db
        .select({ status: userProfile.status })
        .from(userProfile)
        .where(eq(userProfile.userId, session.user.id))
        .limit(1);
    if (profile[0]?.status === "blocked") {
        return res.status(403).json({ message: "Akun Anda diblokir." });
    }
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const start = req.query.start ? new Date(String(req.query.start)) : null;
    const end = req.query.end ? new Date(String(req.query.end)) : null;
    const conditions = [eq(userPointHistory.userId, session.user.id)];
    if (start && !isNaN(start.getTime())) {
        conditions.push(sql `${userPointHistory.createdAt} >= ${start.getTime()}`);
    }
    if (end && !isNaN(end.getTime())) {
        const endOfDay = new Date(end);
        endOfDay.setHours(23, 59, 59, 999);
        conditions.push(sql `${userPointHistory.createdAt} <= ${endOfDay.getTime()}`);
    }
    const whereFinal = conditions.length ? and(...conditions) : undefined;
    const rows = await db
        .select({
        id: userPointHistory.id,
        amount: userPointHistory.amount,
        type: userPointHistory.type,
        description: userPointHistory.description,
        createdAt: userPointHistory.createdAt
    })
        .from(userPointHistory)
        .where(whereFinal)
        .orderBy(sql `${userPointHistory.createdAt} desc`)
        .limit(limit)
        .offset(offset);
    const total = await db
        .select({ count: sql `count(*)` })
        .from(userPointHistory)
        .where(whereFinal);
    return res.json({ data: rows, total: total[0]?.count ?? 0, limit, offset });
});
export default router;
