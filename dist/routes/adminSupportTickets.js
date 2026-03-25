import { Router } from "express";
import { db } from "../db/index.js";
import { supportTicket } from "../db/schema.js";
import { desc, eq } from "drizzle-orm";
const router = Router();
router.get("/tickets", async (req, res) => {
    const status = req.query.status || undefined;
    const rows = await db
        .select({
        id: supportTicket.id,
        ticketNo: supportTicket.ticketNo,
        userId: supportTicket.userId,
        name: supportTicket.name,
        email: supportTicket.email,
        message: supportTicket.message,
        status: supportTicket.status,
        closedAt: supportTicket.closedAt,
        createdAt: supportTicket.createdAt,
        updatedAt: supportTicket.updatedAt
    })
        .from(supportTicket)
        .where(status ? eq(supportTicket.status, status) : undefined)
        .orderBy(desc(supportTicket.createdAt))
        .limit(200);
    return res.json({ items: rows });
});
router.get("/tickets/count", async (req, res) => {
    const status = req.query.status || undefined;
    const rows = await db
        .select({ id: supportTicket.id })
        .from(supportTicket)
        .where(status ? eq(supportTicket.status, status) : undefined);
    return res.json({ count: rows.length });
});
router.patch("/tickets/:id", async (req, res) => {
    const id = req.params.id;
    const status = String(req.body?.status || "").trim();
    if (!id || !["open", "closed"].includes(status)) {
        return res.status(400).json({ message: "Invalid body" });
    }
    const closedAt = status === "closed" ? new Date() : null;
    await db
        .update(supportTicket)
        .set({ status, closedAt, updatedAt: new Date() })
        .where(eq(supportTicket.id, id));
    return res.json({ id, status, closedAt });
});
export default router;
