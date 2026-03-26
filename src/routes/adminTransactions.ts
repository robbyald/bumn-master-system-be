import { Router } from "express";
import { and, desc, eq, like, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { examPackage, paymentOrder, user } from "../db/schema.js";

const router = Router();

const ALLOWED_STATUS = ["pending", "paid", "expired", "failed", "cancelled"] as const;

router.get("/stats", async (_req, res) => {
  const rows = await db.select({ status: paymentOrder.status }).from(paymentOrder);
  const total = rows.length;
  const success = rows.filter((r) => String(r.status).toLowerCase() === "paid").length;
  const pending = rows.filter((r) => String(r.status).toLowerCase() === "pending").length;
  const expired = rows.filter((r) => String(r.status).toLowerCase() === "expired").length;

  return res.json({
    totalTransactions: total,
    totalSuccess: success,
    totalPending: pending,
    totalExpired: expired,
  });
});

router.get("/", async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(10, Math.max(1, Number(req.query.limit || 10)));
  const status = String(req.query.status || "all").toLowerCase();
  const q = String(req.query.q || "").trim();
  const offset = (page - 1) * limit;

  const whereClause = and(
    status !== "all" && ALLOWED_STATUS.includes(status as any)
      ? eq(paymentOrder.status, status)
      : undefined,
    q
      ? or(
          like(paymentOrder.externalOrderNo, `%${q}%`),
          like(paymentOrder.externalInvoiceNo, `%${q}%`),
          like(user.name, `%${q}%`),
          like(user.email, `%${q}%`),
          like(examPackage.title, `%${q}%`),
        )
      : undefined,
  );

  const allRows = await db
    .select({
      id: paymentOrder.id,
      transactionId: paymentOrder.externalOrderNo,
      invoiceNo: paymentOrder.externalInvoiceNo,
      userId: paymentOrder.userId,
      userName: user.name,
      userEmail: user.email,
      packageId: paymentOrder.packageId,
      packageTitle: examPackage.title,
      amount: paymentOrder.amount,
      status: paymentOrder.status,
      provider: paymentOrder.provider,
      createdAt: paymentOrder.createdAt,
      updatedAt: paymentOrder.updatedAt,
      paidAt: paymentOrder.paidAt,
      expiresAt: paymentOrder.expiresAt,
    })
    .from(paymentOrder)
    .leftJoin(user, eq(user.id, paymentOrder.userId))
    .leftJoin(examPackage, eq(examPackage.id, paymentOrder.packageId))
    .where(whereClause)
    .orderBy(desc(paymentOrder.createdAt));

  const total = allRows.length;
  const items = allRows.slice(offset, offset + limit);

  return res.json({
    items,
    total,
    page,
    limit,
  });
});

router.patch("/:id/status", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const nextStatus = String(req.body?.status || "").trim().toLowerCase();
  if (!id || !ALLOWED_STATUS.includes(nextStatus as any)) {
    return res.status(400).json({ message: "Status tidak valid." });
  }

  const paidAt = nextStatus === "paid" ? new Date() : null;
  await db
    .update(paymentOrder)
    .set({
      status: nextStatus,
      paidAt,
      updatedAt: new Date(),
    })
    .where(eq(paymentOrder.id, id));

  return res.json({ ok: true, id, status: nextStatus, paidAt });
});

export default router;

