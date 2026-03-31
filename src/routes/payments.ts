import { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "../auth.js";
import { fromNodeHeaders } from "better-auth/node";
import { db } from "../db/index.js";
import {
  examPackage,
  paymentGatewayConfig,
  paymentMethodConfig,
  paymentOrder,
  userPackage,
  userPointHistory,
  userProfile,
} from "../db/schema.js";
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

const spendPointsOnceForOrder = async (args: {
  userId: string;
  packageId: string;
  orderId: string;
  pointsUsed: number;
}) => {
  const pointsUsed = Math.max(0, Math.floor(args.pointsUsed || 0));
  if (pointsUsed <= 0) return;

  const description = `Diskon poin checkout (${args.orderId})`;
  const existing = await db
    .select({ id: userPointHistory.id })
    .from(userPointHistory)
    .where(
      and(
        eq(userPointHistory.userId, args.userId),
        eq(userPointHistory.type, "spend"),
        eq(userPointHistory.description, description),
      ),
    )
    .limit(1);

  if (existing.length > 0) return;

  await db
    .update(userProfile)
    .set({
      points: sql`CASE WHEN ${userProfile.points} >= ${pointsUsed} THEN ${userProfile.points} - ${pointsUsed} ELSE 0 END`,
    })
    .where(eq(userProfile.userId, args.userId));

  await db.insert(userPointHistory).values({
    id: randomUUID(),
    userId: args.userId,
    amount: pointsUsed,
    type: "spend",
    description,
  });
};

const formatPartnerServiceId = (raw: string) => {
  const trimmedDigits = String(raw || "").trim().replace(/\s+/g, "");
  // DOKU expects max 8 chars and commonly left-padding space for BIN/company code.
  return trimmedDigits.padStart(8, " ").slice(-8);
};

const normalizeMode = (mode: string | null | undefined): "sandbox" | "production" =>
  String(mode || "").toLowerCase() === "production" ? "production" : "sandbox";

const getGatewayMode = async (): Promise<"sandbox" | "production"> => {
  const rows = await db
    .select({ mode: paymentGatewayConfig.mode })
    .from(paymentGatewayConfig)
    .where(eq(paymentGatewayConfig.id, "doku"))
    .limit(1);
  return normalizeMode(rows[0]?.mode);
};

const buildCustomerNoFromConfig = (raw: string) => {
  const seed = String(raw || "").replace(/\D+/g, "").slice(0, 20);
  if (!seed) return "6";
  // Keep single-digit legacy value as-is (matches current sandbox behavior for some BINs).
  if (seed.length <= 1) return seed;
  if (seed.length >= 20) return seed.slice(0, 20);
  const randomTail = String(Date.now()).slice(-Math.max(1, 20 - seed.length));
  return `${seed}${randomTail}`.slice(0, 20);
};

const inferPaymentMethod = (raw: any): string | null => {
  const checkoutName = raw?._checkoutMeta?.paymentMethodName;
  if (typeof checkoutName === "string" && checkoutName.trim()) return checkoutName.trim();

  const channel = String(raw?.virtualAccountData?.additionalInfo?.channel || "").trim();
  if (!channel) return null;
  if (channel.startsWith("VIRTUAL_ACCOUNT_")) {
    const bank = channel.replace("VIRTUAL_ACCOUNT_BANK_", "").replace("VIRTUAL_ACCOUNT_", "");
    return `Virtual Account ${bank}`;
  }
  return channel;
};

const pickMethodConfigByMode = (
  mode: "sandbox" | "production",
  method: {
    sandboxPartnerServiceId: string;
    sandboxCustomerNo: string;
    sandboxChannel: string;
    productionPartnerServiceId: string;
    productionCustomerNo: string;
    productionChannel: string;
  },
) => {
  if (mode === "production") {
    return {
      partnerServiceId: method.productionPartnerServiceId,
      customerNoSeed: method.productionCustomerNo,
      channel: method.productionChannel,
    };
  }
  return {
    partnerServiceId: method.sandboxPartnerServiceId,
    customerNoSeed: method.sandboxCustomerNo,
    channel: method.sandboxChannel,
  };
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

    const mode = await getGatewayMode();
    const doku = getDokuSnap(mode);
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
      const mode = await getGatewayMode();
      const doku = getDokuSnap(mode);
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

router.get("/methods", async (req, res) => {
  const session = await getSession(req);
  if (!session || !session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const mode = await getGatewayMode();
  const methods = await db
    .select({
      id: paymentMethodConfig.id,
      provider: paymentMethodConfig.provider,
      methodType: paymentMethodConfig.methodType,
      bankCode: paymentMethodConfig.bankCode,
      displayName: paymentMethodConfig.displayName,
      isVisible: paymentMethodConfig.isVisible,
      sandboxPartnerServiceId: paymentMethodConfig.sandboxPartnerServiceId,
      sandboxCustomerNo: paymentMethodConfig.sandboxCustomerNo,
      sandboxChannel: paymentMethodConfig.sandboxChannel,
      productionPartnerServiceId: paymentMethodConfig.productionPartnerServiceId,
      productionCustomerNo: paymentMethodConfig.productionCustomerNo,
      productionChannel: paymentMethodConfig.productionChannel,
      sortOrder: paymentMethodConfig.sortOrder,
    })
    .from(paymentMethodConfig)
    .where(and(eq(paymentMethodConfig.provider, "doku"), eq(paymentMethodConfig.isVisible, true)))
    .orderBy(asc(paymentMethodConfig.sortOrder));

  const readyMethods = methods
    .map((m) => {
      const cfg = pickMethodConfigByMode(mode, m);
      return {
        id: m.id,
        provider: m.provider,
        methodType: m.methodType,
        bankCode: m.bankCode,
        displayName: m.displayName,
        channel: cfg.channel,
        isReady: Boolean(cfg.partnerServiceId && cfg.customerNoSeed && cfg.channel),
      };
    })
    .filter((m) => m.isReady);

  return res.json({
    mode,
    methods: readyMethods,
  });
});

router.get("/history", async (req, res) => {
  const session = await getSession(req);
  if (!session || !session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const parsed = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    })
    .safeParse(req.query || {});
  const page = parsed.success ? parsed.data.page : 1;
  const limit = parsed.success ? parsed.data.limit : 10;
  const offset = (page - 1) * limit;

  const allRows = await db
    .select({
      orderId: paymentOrder.id,
      transactionId: paymentOrder.externalOrderNo,
      packageId: paymentOrder.packageId,
      packageTitle: examPackage.title,
      amount: paymentOrder.amount,
      status: paymentOrder.status,
      paymentMethod: paymentOrder.provider,
      rawResponse: paymentOrder.rawResponse,
      expiresAt: paymentOrder.expiresAt,
      createdAt: paymentOrder.createdAt,
      paidAt: paymentOrder.paidAt,
    })
    .from(paymentOrder)
    .leftJoin(examPackage, eq(examPackage.id, paymentOrder.packageId))
    .where(eq(paymentOrder.userId, session.user.id))
    .orderBy(desc(paymentOrder.createdAt));

  const total = allRows.length;
  const rows = allRows.slice(offset, offset + limit);

  return res.json({
    items: rows.map((r) => {
      const raw = (() => {
        try {
          return r.rawResponse ? JSON.parse(r.rawResponse) : {};
        } catch {
          return {};
        }
      })();
      const vaData = raw?.virtualAccountData || {};
      const additionalInfo = vaData?.additionalInfo || {};
      const totalAmount = vaData?.totalAmount || {};

      return {
        ...r,
        paymentMethod: r.paymentMethod || "doku",
        paymentMethodLabel: inferPaymentMethod(raw),
        packageTitle: r.packageTitle || "Paket",
        amount: r.amount ?? 0,
        amountCurrency: totalAmount?.currency || "IDR",
        vaNumber: String(vaData?.virtualAccountNo || "").replace(/\s+/g, ""),
        howToPayPage: additionalInfo?.howToPayPage || null,
        howToPayApi: additionalInfo?.howToPayApi || null,
        expiredDate:
          r.expiresAt
            ? new Date(r.expiresAt).toISOString()
            : (vaData?.expiredDate ? String(vaData.expiredDate) : null),
        rawResponse: undefined,
      };
    }),
    total,
    page,
    limit,
  });
});

router.post("/doku/checkout", async (req, res) => {
  const session = await getSession(req);
  if (!session || !session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const profile = await db
    .select({ status: userProfile.status, phone: userProfile.phone, points: userProfile.points })
    .from(userProfile)
    .where(eq(userProfile.userId, session.user.id))
    .limit(1);

  if (profile[0]?.status === "blocked") {
    return res.status(403).json({ message: "Akun Anda diblokir." });
  }

  const parsed = z
    .object({
      packageId: z.string().min(1),
      pointsToUse: z.coerce.number().int().min(0).optional(),
      paymentMethodId: z.string().min(1).optional(),
    })
    .safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: "packageId is required" });
  }

  const packageId = parsed.data.packageId;
  const mode = await getGatewayMode();
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

  const availablePoints = Math.max(0, Number(profile[0]?.points || 0));
  const requestedPoints = Math.max(0, Number(parsed.data.pointsToUse || 0));
  const clampedToBalance = Math.min(requestedPoints, availablePoints);
  const maxPointsForPaidFlow = Math.max(0, Math.floor((pkg.price - 10000) / 10));
  const maxPointsForFreeFlow = Math.max(0, Math.floor(pkg.price / 10));
  const pointsUsedForFree = Math.min(clampedToBalance, maxPointsForFreeFlow);
  const canBeFullyPaidByPoints = pointsUsedForFree * 10 >= pkg.price;

  const pointsUsed = canBeFullyPaidByPoints
    ? pointsUsedForFree
    : Math.min(clampedToBalance, maxPointsForPaidFlow);
  const pointsDiscount = pointsUsed * 10;
  const finalAmount = Math.max(0, pkg.price - pointsDiscount);

  if (finalAmount === 0) {
    const syntheticOrderId = randomUUID();
    await spendPointsOnceForOrder({
      userId: session.user.id,
      packageId: pkg.id,
      orderId: syntheticOrderId,
      pointsUsed,
    });
    await ensureEnrolled(session.user.id, pkg.id);
    return res.json({
      mode: "points_paid",
      packageId: pkg.id,
      status: "paid",
      pointsUsed,
      amount: { value: "0.00", currency: "IDR" },
    });
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
  const activeMethods = await db
    .select()
    .from(paymentMethodConfig)
    .where(and(eq(paymentMethodConfig.provider, "doku"), eq(paymentMethodConfig.isVisible, true)))
    .orderBy(asc(paymentMethodConfig.sortOrder));

  if (activeMethods.length === 0) {
    return res.status(400).json({ message: "Tidak ada payment method aktif. Silakan hubungi admin." });
  }

  const selectedMethod =
    activeMethods.find((m) => m.id === parsed.data.paymentMethodId) || activeMethods[0]!;

  const selectedConfig = pickMethodConfigByMode(mode, selectedMethod);

  if (!selectedConfig.partnerServiceId || !selectedConfig.customerNoSeed || !selectedConfig.channel) {
    return res.status(400).json({
      message: `Konfigurasi payment method ${selectedMethod.displayName} pada mode ${mode} belum lengkap.`,
    });
  }

  try {
    const doku = getDokuSnap(mode);
    if (typeof doku?.getTokenB2BStrict === "function") {
      await doku.getTokenB2BStrict();
    }

    const partnerServiceId = formatPartnerServiceId(selectedConfig.partnerServiceId);
    const customerNo = buildCustomerNoFromConfig(selectedConfig.customerNoSeed);
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
      totalAmountValue: finalAmount.toFixed(2),
      totalAmountCurrency: "IDR",
      channel: selectedConfig.channel,
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
    const amountValue = vaData?.totalAmount?.value || finalAmount.toFixed(2);
    const amountCurrency = vaData?.totalAmount?.currency || "IDR";
    const responseWithMeta = {
      ...(response || {}),
      _checkoutMeta: {
        baseAmount: pkg.price,
        finalAmount,
        pointsUsed,
        pointsDiscount,
        paymentMethodId: selectedMethod.id,
        paymentMethodName: selectedMethod.displayName,
        gatewayMode: mode,
      },
    };

    await db.insert(paymentOrder).values({
      id: orderId,
      userId: session.user.id,
      packageId: pkg.id,
      provider: "doku",
      externalOrderNo: trxId,
      externalInvoiceNo: String(vaNumber),
      amount: finalAmount,
      status: "pending",
      paymentUrl: null,
      rawResponse: JSON.stringify(responseWithMeta),
      expiresAt: Number.isNaN(new Date(String(vaExpired)).getTime()) ? null : new Date(String(vaExpired)),
    });

    return res.status(201).json({
      orderId,
      packageId: pkg.id,
      paymentMethod: selectedMethod.displayName,
      paymentMethodId: selectedMethod.id,
      vaNumber: String(vaNumber),
      expiredDate: String(vaExpired),
      trxId,
      amount: {
        value: String(amountValue),
        currency: String(amountCurrency),
      },
      pointsUsed,
      pointsDiscount,
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
    const mode = await getGatewayMode();
    const doku = getDokuSnap(mode);
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
      const raw = (() => {
        try {
          return order.rawResponse ? JSON.parse(order.rawResponse) : {};
        } catch {
          return {};
        }
      })();
      const gatewayMode = normalizeMode(raw?._checkoutMeta?.gatewayMode);
      const doku = getDokuSnap(gatewayMode);
      if (typeof doku?.getTokenB2BStrict === "function") {
        await doku.getTokenB2BStrict();
      }
      const vaData = raw?.virtualAccountData || {};
      const hasVaPayload = Boolean(vaData?.partnerServiceId && vaData?.customerNo && vaData?.virtualAccountNo);

      if (hasVaPayload && typeof doku?.checkStatusVa === "function") {
        const statusVaPayload = buildCheckStatusVaRequest({
          partnerServiceId: vaData.partnerServiceId,
          customerNo: String(vaData.customerNo),
          virtualAccountNo: String(vaData.virtualAccountNo),
          virtualAccountName: vaData.virtualAccountName,
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
    const raw = (() => {
      try {
        return order.rawResponse ? JSON.parse(order.rawResponse) : {};
      } catch {
        return {};
      }
    })();
    const pointsUsed = Number(raw?._checkoutMeta?.pointsUsed || 0);
    await spendPointsOnceForOrder({
      userId: session.user.id,
      packageId: order.packageId,
      orderId: order.id,
      pointsUsed,
    });
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

router.get("/orders/:id/instruction", async (req, res) => {
  const session = await getSession(req);
  if (!session || !session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const id = req.params.id;
  const rows = await db
    .select({
      id: paymentOrder.id,
      packageId: paymentOrder.packageId,
      packageTitle: examPackage.title,
      amount: paymentOrder.amount,
      status: paymentOrder.status,
      trxId: paymentOrder.externalOrderNo,
      expiresAt: paymentOrder.expiresAt,
      rawResponse: paymentOrder.rawResponse,
    })
    .from(paymentOrder)
    .leftJoin(examPackage, eq(examPackage.id, paymentOrder.packageId))
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

  const vaData = raw?.virtualAccountData || {};
  const additionalInfo = vaData?.additionalInfo || {};
  const totalAmount = vaData?.totalAmount || {};

  return res.json({
    orderId: order.id,
    packageId: order.packageId,
    packageTitle: order.packageTitle || "Paket",
    status: order.status,
    trxId: order.trxId,
    paymentMethod: inferPaymentMethod(raw),
    amount: {
      value: String(totalAmount?.value || Number(order.amount || 0).toFixed(2)),
      currency: String(totalAmount?.currency || "IDR"),
    },
    vaNumber: String(vaData?.virtualAccountNo || "").replace(/\s+/g, ""),
    expiredDate:
      order.expiresAt
        ? new Date(order.expiresAt).toISOString()
        : (vaData?.expiredDate ? String(vaData.expiredDate) : null),
    howToPayPage: additionalInfo?.howToPayPage || null,
    howToPayApi: additionalInfo?.howToPayApi || null,
  });
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
    const raw = (() => {
      try {
        return order.rawResponse ? JSON.parse(order.rawResponse) : {};
      } catch {
        return {};
      }
    })();
    const pointsUsed = Number(raw?._checkoutMeta?.pointsUsed || 0);
    await spendPointsOnceForOrder({
      userId: order.userId,
      packageId: order.packageId,
      orderId: order.id,
      pointsUsed,
    });
    await ensureEnrolled(order.userId, order.packageId);
  }

  return res.status(200).json({ ok: true });
});

export default router;
