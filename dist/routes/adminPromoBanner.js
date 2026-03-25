import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { promoBanner } from "../db/schema.js";
import { eq } from "drizzle-orm";
import multer from "multer";
import { join, extname } from "node:path";
import { mkdirSync } from "node:fs";
const router = Router();
const uploadDir = join(process.cwd(), "uploads", "promo-banner");
try {
    mkdirSync(uploadDir, { recursive: true });
}
catch {
    // ignore
}
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const safeExt = extname(file.originalname || "").toLowerCase() || ".png";
        cb(null, `banner-${Date.now()}${safeExt}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }
});
const updateSchema = z.object({
    enabled: z.boolean().optional(),
    type: z.enum(["text", "image"]).optional(),
    title: z.string().optional(),
    message: z.string().optional(),
    code: z.string().optional(),
    ctaText: z.string().optional(),
    ctaLink: z.string().optional(),
    imageUrl: z.string().optional()
});
router.get("/", async (_req, res) => {
    const rows = await db.select().from(promoBanner).limit(1);
    const banner = rows[0];
    if (!banner) {
        return res.json({ message: "Promo banner not configured." });
    }
    return res.json(banner);
});
router.put("/", async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
    }
    const data = parsed.data;
    const contentKeys = ["title", "message", "code", "ctaText", "ctaLink", "imageUrl", "type"];
    const hasContentChange = contentKeys.some((k) => k in data);
    const nextVersion = hasContentChange ? `v${Date.now()}` : undefined;
    await db
        .update(promoBanner)
        .set({
        ...data,
        ...(nextVersion ? { version: nextVersion } : {})
    })
        .where(eq(promoBanner.id, "default"));
    const rows = await db.select().from(promoBanner).limit(1);
    const banner = rows[0];
    return res.json(banner);
});
router.post("/upload", upload.single("image"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: "Image file is required." });
    }
    const imageUrl = `/uploads/promo-banner/${req.file.filename}`;
    return res.json({ imageUrl });
});
export default router;
