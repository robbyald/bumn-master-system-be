import { Router } from "express";
import { db } from "../db/index.js";
import { featureToggle } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

const DEFAULT_TOGGLES = {
  id: "global",
  tryout: true,
  catalog: true,
  leaderboard: true,
  materials: true,
  dailyChallenge: true,
  payment: true,
  maintenance: false,
};

router.get("/", async (_req, res) => {
  const rows = await db.select().from(featureToggle).where(eq(featureToggle.id, "global")).limit(1);
  if (!rows.length) {
    await db.insert(featureToggle).values(DEFAULT_TOGGLES);
    return res.json(DEFAULT_TOGGLES);
  }
  const row = rows[0]!;
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

export default router;
