import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { featureToggle } from "../db/schema.js";
import { eq } from "drizzle-orm";
const router = Router();
const schema = z.object({
    tryout: z.boolean(),
    catalog: z.boolean(),
    leaderboard: z.boolean(),
    materials: z.boolean(),
    dailyChallenge: z.boolean(),
    payment: z.boolean(),
    maintenance: z.boolean(),
});
router.get("/", async (_req, res) => {
    const rows = await db.select().from(featureToggle).where(eq(featureToggle.id, "global")).limit(1);
    if (!rows.length) {
        const defaults = {
            id: "global",
            tryout: true,
            catalog: true,
            leaderboard: true,
            materials: true,
            dailyChallenge: true,
            payment: true,
            maintenance: false,
        };
        await db.insert(featureToggle).values(defaults);
        return res.json(defaults);
    }
    const row = rows[0];
    return res.json({
        id: row.id,
        tryout: row.tryout,
        catalog: row.catalog,
        leaderboard: row.leaderboard,
        materials: row.materials,
        dailyChallenge: row.dailyChallenge,
        payment: row.payment,
        maintenance: row.maintenance,
    });
});
router.put("/", async (req, res) => {
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    const data = parsed.data;
    const existing = await db.select().from(featureToggle).where(eq(featureToggle.id, "global")).limit(1);
    if (!existing.length) {
        await db.insert(featureToggle).values({ id: "global", ...data });
    }
    else {
        await db.update(featureToggle).set(data).where(eq(featureToggle.id, "global"));
    }
    return res.json({ ok: true, ...data });
});
export default router;
