import { Router } from "express";
import { z } from "zod";
import { auth } from "../auth.js";
import { fromNodeHeaders } from "better-auth/node";
import { db } from "../db/index.js";
import { user, userProfile } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(6).optional()
});

router.patch("/", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }

  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers)
  });

  if (!session || !session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { name, email, phone } = parsed.data;
  const userId = session.user.id;

  if (name || email) {
    await db.update(user)
      .set({
        ...(name ? { name } : {}),
        ...(email ? { email } : {})
      })
      .where(eq(user.id, userId));
  }

  if (phone !== undefined) {
    await db
      .insert(userProfile)
      .values({
        userId,
        phone
      })
      .onConflictDoUpdate({
        target: userProfile.userId,
        set: { phone }
      });
  }

  return res.json({ ok: true });
});

export default router;
