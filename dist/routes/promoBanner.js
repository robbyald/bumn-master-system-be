import { Router } from "express";
import { db } from "../db/index.js";
import { promoBanner } from "../db/schema.js";
const router = Router();
router.get("/", async (_req, res) => {
    const rows = await db.select().from(promoBanner).limit(1);
    const banner = rows[0];
    if (!banner) {
        return res.json({
            enabled: false,
            type: "text",
            title: "",
            message: "",
            code: "",
            ctaText: "",
            ctaLink: "",
            imageUrl: "",
            version: "v1"
        });
    }
    return res.json({
        enabled: banner.enabled,
        type: banner.type,
        title: banner.title,
        message: banner.message,
        code: banner.code,
        ctaText: banner.ctaText,
        ctaLink: banner.ctaLink,
        imageUrl: banner.imageUrl,
        version: banner.version
    });
});
export default router;
