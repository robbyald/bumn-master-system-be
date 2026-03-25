import { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "../auth.js";
import { fromNodeHeaders } from "better-auth/node";
import { db } from "../db/index.js";
import { examPackage, paymentOrder, userPackage, userProfile } from "../db/schema.js";
import {
  buildCheckStatusRequest,
  buildCheckStatusVaRequest,
  buildCreateVaRequest,
  getDokuSnap,
  mapDokuStatus,
  mapDokuVaStatus,
} from "../lib/dokuClient.js";

const router = Router();

const getSession = (req: any) =>
  auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

const ensureEnrolled = async (userId: string, packageId: string) => {
  const existing = await db
    .select({ userId: userPackage.userId })
    .from(userPackage)
    .where(and(eq(userPackage.userId, userId), eq(userPackage.packageId, packageId)))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(userPackage).values({ userId, packageId });
  }
};

const formatPartnerServiceId = (raw: string) => {
  const trimmedDigits = String(raw || "").trim().replace(/\s+/g, "");
  // DOKU expects max 8 chars and commonly left-padding space for BIN/company code.
  return trimmedDigits.padStart(8, " ").slice(-8);
};

const formatCustomerNo2Digits = (raw: string) => {
  const digits = String(raw || "").replace(/\D+/g, "");
  if (!digits) return "01";
  return digits.slice(-2).padStart(2, "0");
};

const toIsoWithOffset = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const tzOffset = -date.getTimezoneOffset();
  const sign = tzOffset >= 0 ? "+" : "-";
  const tzH = pad(Math.floor(Math.abs(tzOffset) / 60));
  const tzM = pad(Math.abs(tzOffset) % 60);
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${sign}${tzH}:${tzM}`;
};

router.get("/doku/token-b2b", async (req, res) => {
  try {
    const session = await getSession(req);
    if (!session || !session.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const doku = getDokuSnap();
    if (typeof doku?.getTokenB2B !== "function") {
      return res.status(500).json({ message: "Method getTokenB2B tidak tersedia di DOKU SDK." });
    }
    const tokenResp =
      typeof doku?.getTokenB2BStrict === "function"
        ? await doku.getTokenB2BStrict()
        : await doku.getTokenB2B();
    if (doku?.__lastTokenDebug) {
      console.log("[DOKU TOKEN DEBUG] X-TIMESTAMP:", doku.__lastTokenDebug.xTimestamp);
      console.log("[DOKU TOKEN DEBUG] X-CLIENT-KEY:", doku.__lastTokenDebug.clientId);
    }
    return res.status(200).json({
      ok: true,
      token: tokenResp,
    });
  } catch (err: any) {
    try {
      const doku = getDokuSnap();
      if (doku?.__lastTokenDebug) {
        console.log("[DOKU TOKEN DEBUG] X-TIMESTAMP:", doku.__lastTokenDebug.xTimestamp);
        console.log("[DOKU TOKEN DEBUG] X-CLIENT-KEY:", doku.__lastTokenDebug.clientId);
      }
    } catch {
      // ignore secondary debug error
    }
    return res.status(500).json({
      ok: false,
      message: err?.message || "Gagal getTokenB2B.",
      dokuError: err?.response?.data || null,
      stack: process.env.NODE_ENV === "production" ? undefined : err?.stack,
    });
  }
});

router.post("/doku/checkout", async (req, res) => {
  const session = await getSession(req);
  if (!session || !session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const profile = await db
    .select({ status: userProfile.status, phone: userProfile.phone })
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
  const channel = "VIRTUAL_ACCOUNT_BRI";

  try {
    const doku = getDokuSnap();
    if (typeof doku?.getTokenB2BStrict === "function") {
      await doku.getTokenB2BStrict();
    }

    // Temporary hardcode for payload parity against Postman success sample.
    const partnerServiceId = "   13925";
    const customerNo = "6";
    const trxId = `MBUMN-VA-${Date.now()}`;
    const expiredDate = toIsoWithOffset(new Date(Date.now() + 30 * 60 * 1000));
    const virtualAccountName = (session.user.name || "").trim();
    const virtualAccountEmail = (session.user.email || "").trim();
    const virtualAccountPhone = (profile[0]?.phone || "").trim();
    const requestPayload = buildCreateVaRequest({
      partnerServiceId,
      customerNo,
      virtualAccountName,
      virtualAccountEmail,
      virtualAccountPhone,
      trxId,
      totalAmountValue: pkg.price.toFixed(2),
      totalAmountCurrency: "IDR",
      channel,
      reusableStatus: false,
      virtualAccountTrxType: "C",
      expiredDate,
      freeText: [],
    });
    console.log("[DOKU CREATE-VA REQUEST][checkout]", {
      partnerServiceId: requestPayload.partnerServiceId,
      customerNo: requestPayload.customerNo,
      virtualAccountNo: requestPayload.virtualAccountNo,
      virtualAccountName: requestPayload.virtualAccountName,
      virtualAccountEmail: requestPayload.virtualAccountEmail,
      virtualAccountPhone: requestPayload.virtualAccountPhone,
      trxId: requestPayload.trxId,
      totalAmount: requestPayload.totalAmount,
      additionalInfo: requestPayload.additionalInfo,
      virtualAccountTrxType: requestPayload.virtualAccountTrxType,
      expiredDate: requestPayload.expiredDate,
      freeText: requestPayload.freeText,
    });
    const response = await doku.createVa(requestPayload);
    const vaData = response?.virtualAccountData || {};
    const vaNumber =
      response?.virtualAccountNo ||
      vaData?.virtualAccountNo ||
      `${partnerServiceId}${customerNo}`;
    const vaExpired =
      response?.expiredDate ||
      vaData?.expiredDate ||
      expiredDate;
    const howToPayPage = vaData?.additionalInfo?.howToPayPage || null;
    const howToPayApi = vaData?.additionalInfo?.howToPayApi || null;
    const amountValue = vaData?.totalAmount?.value || pkg.price.toFixed(2);
    const amountCurrency = vaData?.totalAmount?.currency || "IDR";

    await db.insert(paymentOrder).values({
      id: orderId,
      userId: session.user.id,
      packageId: pkg.id,
      provider: "doku",
      externalOrderNo: trxId,
      externalInvoiceNo: String(vaNumber),
      amount: pkg.price,
      status: "pending",
      paymentUrl: null,
      rawResponse: JSON.stringify(response || {}),
    });

    return res.status(201).json({
      orderId,
      packageId: pkg.id,
      paymentMethod: "VIRTUAL_ACCOUNT_BRI",
      vaNumber: String(vaNumber),
      expiredDate: String(vaExpired),
      trxId,
      amount: {
        value: String(amountValue),
        currency: String(amountCurrency),
      },
      howToPayPage,
      howToPayApi,
      status: "pending",
    });
  } catch (err: any) {
    const dokuError = err?.response?.data || null;
    return res.status(500).json({
      message: err?.message || "Gagal membuat transaksi DOKU.",
      dokuError,
    });
  }
});

router.post("/doku/create-va", async (req, res) => {
  const session = await getSession(req);
  if (!session || !session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const parsed = z
    .object({
      partnerServiceId: z.string().min(1),
      customerNo: z.string().min(1),
      virtualAccountName: z.string().min(1),
      virtualAccountEmail: z.string().optional(),
      virtualAccountPhone: z.string().optional(),
      trxId: z.string().min(1),
      totalAmount: z.object({
        value: z.string().min(1),
        currency: z.string().optional(),
      }),
      additionalInfo: z.object({
        channel: z.string().min(1),
        virtualAccountConfig: z
          .object({
            reusableStatus: z.boolean().optional(),
          })
          .optional(),
      }),
      virtualAccountTrxType: z.string().optional(),
      expiredDate: z.string().optional(),
      freeText: z
        .array(
          z.object({
            english: z.string().optional(),
            indonesia: z.string().optional(),
          })
        )
        .optional(),
    })
    .safeParse(req.body || {});

  if (!parsed.success) {
    return res.status(400).json({
      message: "Payload create-va tidak valid.",
      issues: parsed.error.flatten(),
    });
  }

  try {
    const doku = getDokuSnap();
    if (typeof doku?.getTokenB2BStrict === "function") {
      await doku.getTokenB2BStrict();
    }

    const body = parsed.data;
    const requestPayload = buildCreateVaRequest({
      partnerServiceId: body.partnerServiceId,
      customerNo: body.customerNo,
      virtualAccountName: body.virtualAccountName,
      virtualAccountEmail: body.virtualAccountEmail,
      virtualAccountPhone: body.virtualAccountPhone,
      trxId: body.trxId,
      totalAmountValue: body.totalAmount.value,
      totalAmountCurrency: body.totalAmount.currency || "IDR",
      channel: body.additionalInfo.channel,
      reusableStatus: body.additionalInfo.virtualAccountConfig?.reusableStatus ?? false,
      virtualAccountTrxType: body.virtualAccountTrxType || "C",
      expiredDate: body.expiredDate,
      freeText: body.freeText || [],
    });
    console.log("[DOKU CREATE-VA REQUEST][manual]", {
      partnerServiceId: requestPayload.partnerServiceId,
      customerNo: requestPayload.customerNo,
      virtualAccountNo: requestPayload.virtualAccountNo,
      virtualAccountName: requestPayload.virtualAccountName,
      virtualAccountEmail: requestPayload.virtualAccountEmail,
      virtualAccountPhone: requestPayload.virtualAccountPhone,
      trxId: requestPayload.trxId,
      totalAmount: requestPayload.totalAmount,
      additionalInfo: requestPayload.additionalInfo,
      virtualAccountTrxType: requestPayload.virtualAccountTrxType,
      expiredDate: requestPayload.expiredDate,
      freeText: requestPayload.freeText,
    });

    const response = await doku.createVa(requestPayload);
    return res.status(200).json(response);
  } catch (err: any) {
    return res.status(500).json({
      message: err?.message || "Gagal create VA ke DOKU.",
      dokuError: err?.response?.data || null,
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
  let rawStatusResponse: any = null;
  let statusCheckMode: "va" | "direct_debit" | "none" = "none";
  let statusCheckRequest: any = null;
  let statusCheckError: any = null;

  if (order.status === "pending") {
    try {
      const doku = getDokuSnap();
      if (typeof doku?.getTokenB2BStrict === "function") {
        await doku.getTokenB2BStrict();
      }
      const raw = (() => {
        try {
          return order.rawResponse ? JSON.parse(order.rawResponse) : {};
        } catch {
          return {};
        }
      })();
      const vaData = raw?.virtualAccountData || {};
      const hasVaPayload = Boolean(vaData?.partnerServiceId && vaData?.customerNo && vaData?.virtualAccountNo);

      if (hasVaPayload && typeof doku?.checkStatusVa === "function") {
        const statusVaPayload = buildCheckStatusVaRequest({
          partnerServiceId: vaData.partnerServiceId,
          customerNo: String(vaData.customerNo),
          virtualAccountNo: String(vaData.virtualAccountNo),
          virtualAccountName: vaData.virtualAccountName,
          inquiryRequestId: null as any,
          paymentRequestId: null as any,
          additionalInfo: "",
        });
        console.log("[DOKU CHECK-STATUS-VA REQUEST]", {
          partnerServiceId: statusVaPayload.partnerServiceId,
          customerNo: statusVaPayload.customerNo,
          virtualAccountNo: statusVaPayload.virtualAccountNo,
          inquiryRequestId: statusVaPayload.inquiryRequestId,
          paymentRequestId: statusVaPayload.paymentRequestId,
          additionalInfo: statusVaPayload.additionalInfo,
          sourceOrderId: order.id,
          sourceTrxId: order.externalOrderNo,
        });
        statusCheckMode = "va";
        statusCheckRequest = {
          partnerServiceId: statusVaPayload.partnerServiceId,
          customerNo: statusVaPayload.customerNo,
          virtualAccountNo: statusVaPayload.virtualAccountNo,
          inquiryRequestId: statusVaPayload.inquiryRequestId,
          paymentRequestId: statusVaPayload.paymentRequestId,
          additionalInfo: statusVaPayload.additionalInfo,
        };
        rawStatusResponse = await doku.checkStatusVa(statusVaPayload);
        currentStatus = mapDokuVaStatus(rawStatusResponse);
      } else {
        const statusPayload = buildCheckStatusRequest({
          originalPartnerReferenceNo: order.externalInvoiceNo || order.externalOrderNo,
          amountValue: order.amount,
        });
        statusCheckMode = "direct_debit";
        statusCheckRequest = statusPayload;
        rawStatusResponse = await doku.doCheckStatus(statusPayload);
        currentStatus = mapDokuStatus(rawStatusResponse);
      }

      await db
        .update(paymentOrder)
        .set({
          status: currentStatus,
          rawCallback: JSON.stringify({
            type: "status_check",
            checkedAt: new Date().toISOString(),
            mode: statusCheckMode,
            request: statusCheckRequest,
            response: rawStatusResponse,
          }),
          paidAt: currentStatus === "paid" ? new Date() : order.paidAt,
        })
        .where(eq(paymentOrder.id, order.id));
    } catch (err: any) {
      statusCheckError = {
        message: err?.message || "status-check-failed",
        dokuError: err?.response?.data || null,
      };
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
    statusCheck: {
      mode: statusCheckMode,
      request: statusCheckRequest,
      response: rawStatusResponse,
      error: statusCheckError,
    },
  });
});

router.get("/orders/:id/how-to-pay", async (req, res) => {
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

  const raw = (() => {
    try {
      return order.rawResponse ? JSON.parse(order.rawResponse) : {};
    } catch {
      return {};
    }
  })();

  const howToPayApi =
    raw?.virtualAccountData?.additionalInfo?.howToPayApi ||
    raw?.additionalInfo?.howToPayApi ||
    null;

  if (!howToPayApi) {
    return res.status(404).json({ message: "howToPayApi tidak ditemukan pada order ini." });
  }

  try {
    const resp = await fetch(String(howToPayApi), {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const text = await resp.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep text
    }
    if (!resp.ok) {
      return res.status(resp.status).json({
        message: "Gagal mengambil instruksi pembayaran.",
        howToPayApi,
        body,
      });
    }
    return res.json({
      howToPayApi,
      data: body,
    });
  } catch (err: any) {
    return res.status(500).json({
      message: err?.message || "Gagal mengambil instruksi pembayaran.",
      howToPayApi,
    });
  }
});

router.post("/doku/webhook", async (req, res) => {
  // Minimal webhook receiver for sandbox observability.
  // Signature verification can be added once header format from merchant setup is finalized.
  const payload = req.body || {};
  const invoiceNumber =
    payload?.order?.invoice_number ||
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
