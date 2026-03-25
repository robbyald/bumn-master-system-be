import { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "../auth.js";
import { fromNodeHeaders } from "better-auth/node";
import { db } from "../db/index.js";
import { env } from "../env.js";
import { examPackage, paymentOrder, userPackage, userProfile } from "../db/schema.js";
import { buildCheckStatusRequest, buildPaymentJumpAppRequest, createDokuClient, dokuDoCheckStatus, dokuDoPaymentJumpApp, extractCheckoutUrl, extractInvoiceNumber, mapDokuStatus, } from "../lib/dokuClient.js";
const router = Router();
const getSession = (req) => auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
});
const ensureEnrolled = async (userId, packageId) => {
    const existing = await db
        .select({ userId: userPackage.userId })
        .from(userPackage)
        .where(and(eq(userPackage.userId, userId), eq(userPackage.packageId, packageId)))
        .limit(1);
    if (existing.length === 0) {
        await db.insert(userPackage).values({ userId, packageId });
    }
};
router.post("/doku/checkout", async (req, res) => {
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
    const parsed = z.object({ packageId: z.string().min(1) }).safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(400).json({ message: "packageId is required" });
    }
    const packageId = parsed.data.packageId;
    const pkgRows = await db
        .select({
        id: examPackage.id,
        title: examPackage.title,
        price: examPackage.price,
    })
        .from(examPackage)
        .where(eq(examPackage.id, packageId))
        .limit(1);
    const pkg = pkgRows[0];
    if (!pkg) {
        return res.status(404).json({ message: "Package not found" });
    }
    if (pkg.price <= 0) {
        await ensureEnrolled(session.user.id, pkg.id);
        return res.json({ mode: "free", packageId: pkg.id, status: "paid" });
    }
    const existingPaid = await db
        .select({ id: userPackage.packageId })
        .from(userPackage)
        .where(and(eq(userPackage.userId, session.user.id), eq(userPackage.packageId, pkg.id)))
        .limit(1);
    if (existingPaid.length > 0) {
        return res.json({ mode: "already_paid", packageId: pkg.id, status: "paid" });
    }
    const orderId = randomUUID();
    const externalOrderNo = `DOKU-${Date.now()}-${orderId.slice(0, 8).toUpperCase()}`;
    const requestPayload = buildPaymentJumpAppRequest({
        partnerReferenceNo: externalOrderNo,
        amountValue: pkg.price,
        orderTitle: pkg.title,
        returnUrl: `${env.APP_BASE_URL}/catalog?doku_order_id=${orderId}`,
        validUpToIso: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    try {
        const doku = createDokuClient();
        const forwardedIp = String(req.headers["x-forwarded-for"] || "").split(",")[0]?.trim() ||
            String(req.headers["x-real-ip"] || "").trim() ||
            "127.0.0.1";
        const response = await dokuDoPaymentJumpApp(doku, requestPayload, forwardedIp, "MBUMN-DEVICE");
        const paymentUrl = extractCheckoutUrl(response);
        const invoiceNo = extractInvoiceNumber(response) || externalOrderNo;
        if (!paymentUrl) {
            return res.status(502).json({
                message: "DOKU tidak mengembalikan payment URL.",
                raw: response || null,
            });
        }
        await db.insert(paymentOrder).values({
            id: orderId,
            userId: session.user.id,
            packageId: pkg.id,
            provider: "doku",
            externalOrderNo,
            externalInvoiceNo: invoiceNo,
            amount: pkg.price,
            status: "pending",
            paymentUrl,
            rawResponse: JSON.stringify(response || {}),
        });
        return res.status(201).json({
            orderId,
            packageId: pkg.id,
            paymentUrl,
            status: "pending",
        });
    }
    catch (err) {
        const dokuError = err?.response?.data || null;
        return res.status(500).json({
            message: err?.message || "Gagal membuat transaksi DOKU.",
            dokuError,
        });
    }
});
router.get("/orders/:id/status", async (req, res) => {
    const session = await getSession(req);
    if (!session || !session.user) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    const id = req.params.id;
    const rows = await db
        .select()
        .from(paymentOrder)
        .where(and(eq(paymentOrder.id, id), eq(paymentOrder.userId, session.user.id)))
        .limit(1);
    const order = rows[0];
    if (!order) {
        return res.status(404).json({ message: "Order not found" });
    }
    let currentStatus = order.status;
    let rawStatusResponse = null;
    if (order.status === "pending") {
        try {
            const doku = createDokuClient();
            const statusPayload = buildCheckStatusRequest({
                originalPartnerReferenceNo: order.externalInvoiceNo || order.externalOrderNo,
                amountValue: order.amount,
            });
            rawStatusResponse = await dokuDoCheckStatus(doku, statusPayload);
            currentStatus = mapDokuStatus(rawStatusResponse);
            await db
                .update(paymentOrder)
                .set({
                status: currentStatus,
                rawResponse: JSON.stringify(rawStatusResponse || {}),
                paidAt: currentStatus === "paid" ? new Date() : order.paidAt,
            })
                .where(eq(paymentOrder.id, order.id));
        }
        catch {
            // keep pending status on transient status-check failure
        }
    }
    if (currentStatus === "paid") {
        await ensureEnrolled(session.user.id, order.packageId);
    }
    return res.json({
        id: order.id,
        packageId: order.packageId,
        amount: order.amount,
        status: currentStatus,
        paymentUrl: order.paymentUrl,
        raw: rawStatusResponse,
    });
});
router.post("/doku/webhook", async (req, res) => {
    // Minimal webhook receiver for sandbox observability.
    // Signature verification can be added once header format from merchant setup is finalized.
    const payload = req.body || {};
    const invoiceNumber = payload?.order?.invoice_number ||
        payload?.invoice_number ||
        payload?.transaction?.invoice_number ||
        null;
    if (!invoiceNumber) {
        return res.status(200).json({ ok: true });
    }
    const rows = await db
        .select()
        .from(paymentOrder)
        .where(eq(paymentOrder.externalInvoiceNo, String(invoiceNumber)))
        .limit(1);
    const order = rows[0];
    if (!order) {
        return res.status(200).json({ ok: true });
    }
    const mapped = mapDokuStatus(payload);
    await db
        .update(paymentOrder)
        .set({
        status: mapped,
        rawCallback: JSON.stringify(payload),
        paidAt: mapped === "paid" ? new Date() : order.paidAt,
    })
        .where(eq(paymentOrder.id, order.id));
    if (mapped === "paid") {
        await ensureEnrolled(order.userId, order.packageId);
    }
    return res.status(200).json({ ok: true });
});
export default router;
