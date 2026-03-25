import { Router } from "express";
import { db } from "../db/index.js";
import { paymentOrder, questionBank, user } from "../db/schema.js";
import { sql } from "drizzle-orm";
const router = Router();
router.get("/stats", async (_req, res) => {
    const userRows = await db.select({ total: sql `count(*)` }).from(user);
    const questionRows = await db.select({ total: sql `count(*)` }).from(questionBank);
    const revenueRows = await db
        .select({ total: sql `coalesce(sum(${paymentOrder.amount}), 0)` })
        .from(paymentOrder)
        .where(sql `${paymentOrder.status} = 'paid'`);
    const totalUsers = userRows[0]?.total ?? 0;
    const totalQuestions = questionRows[0]?.total ?? 0;
    const totalBank = 15000;
    const totalRevenue = revenueRows[0]?.total ?? 0;
    return res.json({
        totalUsers,
        totalQuestions,
        totalBank,
        totalRevenue
    });
});
export default router;
