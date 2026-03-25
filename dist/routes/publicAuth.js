import { Router } from "express";
import { z } from "zod";
import { auth } from "../auth.js";
import { db } from "../db/index.js";
import { userProfile } from "../db/schema.js";
import { isAPIError } from "better-auth/api";
const router = Router();
const signupSchema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
    targetBumn: z.string().min(1).optional().nullable(),
    phone: z.string().min(6).optional().nullable()
});
router.post("/signup", async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    }
    const { name, email, password, targetBumn, phone } = parsed.data;
    try {
        const result = await auth.api.signUpEmail({
            body: { name, email, password }
        });
        await db
            .insert(userProfile)
            .values({
            userId: result.user.id,
            role: "user",
            status: "active",
            targetBumn: targetBumn ?? null,
            phone: phone ?? null,
            points: 0
        })
            .onConflictDoNothing();
        return res.status(201).json({
            user: result.user
        });
    }
    catch (err) {
        if (isAPIError(err)) {
            return res.status(400).json({ message: err.message });
        }
        return res.status(500).json({ message: "Server error" });
    }
});
export default router;
