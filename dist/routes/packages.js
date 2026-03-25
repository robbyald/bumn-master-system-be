import { Router } from "express";
import { db } from "../db/index.js";
import { examPackage, paymentOrder, userPackage, userProfile } from "../db/schema.js";
import { eq, sql, and } from "drizzle-orm";
import { auth } from "../auth.js";
import { fromNodeHeaders } from "better-auth/node";
const router = Router();
const getSession = (req) => {
    return auth.api.getSession({
        headers: fromNodeHeaders(req.headers)
    });
};
router.get("/", async (_req, res) => {
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
        educationLevel: examPackage.educationLevel
    })
        .from(examPackage)
        .orderBy(sql `${examPackage.createdAt} desc`);
    const data = rows.map((r) => ({
        ...r,
        categories: JSON.parse(r.categories)
    }));
    return res.json({ data });
});
router.post("/:id/enroll", async (req, res) => {
    const session = await getSession(req);
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
    const { id } = req.params;
    const pkg = await db
        .select({ id: examPackage.id, price: examPackage.price })
        .from(examPackage)
        .where(eq(examPackage.id, id))
        .limit(1);
    if (pkg.length === 0) {
        return res.status(404).json({ message: "Package not found" });
    }
    if ((pkg[0]?.price || 0) > 0) {
        const paidOrder = await db
            .select({ id: paymentOrder.id })
            .from(paymentOrder)
            .where(and(eq(paymentOrder.userId, session.user.id), eq(paymentOrder.packageId, id), eq(paymentOrder.status, "paid")))
            .limit(1);
        if (paidOrder.length === 0) {
            return res.status(403).json({ message: "Paket berbayar harus melalui checkout payment gateway." });
        }
    }
    const existing = await db
        .select({ userId: userPackage.userId })
        .from(userPackage)
        .where(and(eq(userPackage.userId, session.user.id), eq(userPackage.packageId, id)))
        .limit(1);
    if (existing.length === 0) {
        await db.insert(userPackage).values({ userId: session.user.id, packageId: id });
    }
    return res.status(201).json({ packageId: id });
});
router.get("/:id", async (req, res) => {
    const { id } = req.params;
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
        educationLevel: examPackage.educationLevel
    })
        .from(examPackage)
        .where(eq(examPackage.id, id))
        .limit(1);
    if (rows.length === 0) {
        return res.status(404).json({ message: "Package not found" });
    }
    const r = rows[0];
    return res.json({
        ...r,
        categories: JSON.parse(r.categories)
    });
});
export default router;
