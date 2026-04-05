import { createRequire } from "node:module";
import { env } from "../env.js";

const require = createRequire(import.meta.url);

type AnyRecord = Record<string, any>;

const unwrapQuoted = (value: string) => {
  const v = String(value || "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
};

const decodePem = (value: string) => unwrapQuoted(value).replace(/\\n/g, "\n").trim();

const getSdk = () => {
  try {
    return require("doku-nodejs-library");
  } catch {
    throw new Error("DOKU SDK belum terpasang. Jalankan: npm i doku-nodejs-library");
  }
};

export const ensureDokuConfig = () => {
  if (!env.DOKU_CLIENT_ID || !env.DOKU_SECRET_KEY || !env.DOKU_PRIVATE_KEY) {
    throw new Error(
      "DOKU config belum lengkap. Wajib isi DOKU_CLIENT_ID, DOKU_SECRET_KEY, dan DOKU_PRIVATE_KEY."
    );
  }
};

const snapSingletonByMode: Record<string, any> = {};

class SafeSnap extends (getSdk().Snap as any) {
  constructor(...args: any[]) {
    super(...args);
  }

  async getTokenB2B() {
    try {
      return await super.getTokenB2B();
    } catch (error) {
      (this as any).__bootTokenError = error;
      return {
        responseCode: "5000000",
        responseMessage: (error as any)?.message || "Failed to get token",
      };
    }
  }

  async getTokenB2BStrict() {
    const TokenService = require("doku-nodejs-library/_services/tokenService");
    const xTimestamp = TokenService.generateTimestamp();
    const clientId = this.clientId;
    const signature = TokenService.generateSignature(this.privateKey, clientId, xTimestamp);
    const reqDto = TokenService.createTokenB2BRequestDTO(signature, xTimestamp, clientId);
    (this as any).__lastTokenDebug = { xTimestamp, clientId };
    const tokenResp = await TokenService.createTokenB2B(reqDto, this.isProduction);
    if (!tokenResp?.accessToken || !tokenResp?.expiresIn) {
      throw new Error("Invalid token response");
    }
    this.setTokenB2B(tokenResp);
    return tokenResp;
  }
}

// Mirroring sample app flow: create one Snap instance and reuse it.
export const getDokuSnap = (mode: "sandbox" | "production" = (env.DOKU_ENV as any) || "sandbox") => {
  const resolvedMode = mode === "production" ? "production" : "sandbox";
  if (snapSingletonByMode[resolvedMode]) return snapSingletonByMode[resolvedMode];

  ensureDokuConfig();
  const sdk = getSdk();
  if (typeof sdk?.Snap !== "function") {
    throw new Error("DOKU SDK tidak valid: class Snap tidak ditemukan.");
  }

  snapSingletonByMode[resolvedMode] = new SafeSnap({
    isProduction: resolvedMode === "production",
    privateKey: decodePem(env.DOKU_PRIVATE_KEY),
    clientID: String(env.DOKU_CLIENT_ID || "").trim(),
    publicKey: env.DOKU_PUBLIC_KEY ? decodePem(env.DOKU_PUBLIC_KEY) : "",
    dokuPublicKey: env.DOKU_PUBLIC_KEY_DOKU ? decodePem(env.DOKU_PUBLIC_KEY_DOKU) : "",
    issuer: env.DOKU_ISSUER || "",
    secretKey: String(env.DOKU_SECRET_KEY || "").trim(),
  });

  return snapSingletonByMode[resolvedMode];
};

export const buildPaymentJumpAppRequest = (payload: {
  partnerReferenceNo: string;
  amountValue: number;
  returnUrl: string;
  validUpToIso: string;
  orderTitle: string;
}) => {
  const PaymentJumpAppRequestDto = require("doku-nodejs-library/_models/paymentJumpAppRequestDTO");
  const req = new PaymentJumpAppRequestDto();
  req.partnerReferenceNo = payload.partnerReferenceNo;
  req.pointOfInitiation = "Mobile App";
  req.urlParam = [{ url: payload.returnUrl, type: "PAY_RETURN", isDeepLink: "N" }];
  req.amount = { value: payload.amountValue.toFixed(2), currency: "IDR" };
  req.additionalInfo = {
    channel: env.DOKU_CHANNEL,
    orderTitle: payload.orderTitle,
  };
  req.validUpTo = payload.validUpToIso;
  return req;
};

export const buildCheckStatusRequest = (payload: {
  originalPartnerReferenceNo: string;
  amountValue: number;
  transactionDateIso?: string;
}) => {
  const CheckStatusDirectDebitDTO = require("doku-nodejs-library/_models/checkStatusDirectDebitRequestDTO");
  const req = new CheckStatusDirectDebitDTO();
  req.originalPartnerReferenceNo = payload.originalPartnerReferenceNo;
  req.serviceCode = "55";
  req.transactionDate = payload.transactionDateIso || new Date().toISOString();
  req.amount = { value: payload.amountValue.toFixed(2), currency: "IDR" };
  req.additionalInfo = { channel: env.DOKU_CHANNEL };
  return req;
};

export const buildCheckStatusVaRequest = (payload: {
  partnerServiceId: string;
  customerNo: string;
  virtualAccountNo: string;
  virtualAccountName?: string;
  inquiryRequestId?: string;
  paymentRequestId?: string;
  additionalInfo?: string;
}) => {
  const CheckStatusVARequestDto = require("doku-nodejs-library/_models/checkStatusVARequestDTO");
  const req = new CheckStatusVARequestDto();
  req.partnerServiceId = payload.partnerServiceId;
  req.customerNo = payload.customerNo;
  req.virtualAccountNo = payload.virtualAccountNo;
  if (payload.inquiryRequestId) req.inquiryRequestId = payload.inquiryRequestId;
  if (payload.paymentRequestId) req.paymentRequestId = payload.paymentRequestId;
  if (payload.additionalInfo) req.additionalInfo = payload.additionalInfo;
  return req;
};

export const buildCreateVaRequest = (payload: {
  partnerServiceId: string;
  customerNo: string;
  virtualAccountName: string;
  virtualAccountEmail?: string;
  virtualAccountPhone?: string;
  trxId: string;
  totalAmountValue: string;
  totalAmountCurrency?: string;
  channel: string;
  reusableStatus?: boolean;
  virtualAccountTrxType?: string;
  expiredDate?: string;
  freeText?: Array<{ english?: string; indonesia?: string }>;
}) => {
  const CreateVARequestDto = require("doku-nodejs-library/_models/createVaRequestDto");
  const TotalAmount = require("doku-nodejs-library/_models/totalAmount");
  const AdditionalInfo = require("doku-nodejs-library/_models/additionalInfo");
  const VirtualAccountConfig = require("doku-nodejs-library/_models/virtualAccountConfig");

  const req = new CreateVARequestDto();
  req.partnerServiceId = payload.partnerServiceId;
  req.customerNo = payload.customerNo;
  req.virtualAccountNo = `${payload.partnerServiceId}${payload.customerNo}`;
  req.virtualAccountName = payload.virtualAccountName;
  req.virtualAccountEmail = payload.virtualAccountEmail || "";
  req.virtualAccountPhone = payload.virtualAccountPhone || "";
  req.trxId = payload.trxId;

  const totalAmount = new TotalAmount();
  totalAmount.value = payload.totalAmountValue;
  totalAmount.currency = payload.totalAmountCurrency || "IDR";
  req.totalAmount = totalAmount;

  const virtualAccountConfig = new VirtualAccountConfig();
  virtualAccountConfig.reusableStatus = Boolean(payload.reusableStatus ?? false);
  const additionalInfo = new AdditionalInfo(payload.channel, virtualAccountConfig);
  additionalInfo.channel = payload.channel;
  additionalInfo.virtualAccountConfig = virtualAccountConfig;
  req.additionalInfo = additionalInfo;

  req.virtualAccountTrxType = payload.virtualAccountTrxType || "C";
  req.expiredDate = payload.expiredDate || "";
  req.freeText = payload.freeText || [];

  return req;
};

export const extractCheckoutUrl = (resp: AnyRecord): string | null => {
  const candidates = [
    resp?.webRedirectUrl,
    resp?.response?.webRedirectUrl,
    resp?.redirect_url,
    resp?.checkout_url,
  ];
  return candidates.find((v) => typeof v === "string" && v.length > 0) || null;
};

export const extractInvoiceNumber = (resp: AnyRecord): string | null => {
  const candidates = [
    resp?.partnerReferenceNo,
    resp?.originalPartnerReferenceNo,
    resp?.invoice_number,
    resp?.response?.partnerReferenceNo,
  ];
  return candidates.find((v) => typeof v === "string" && v.length > 0) || null;
};

export const mapDokuStatus = (resp: AnyRecord): "pending" | "paid" | "failed" | "expired" | "cancelled" => {
  const raw =
    resp?.latestTransactionStatus ||
    resp?.transactionStatusDesc ||
    resp?.status ||
    resp?.response?.status ||
    "";
  const status = String(raw).toUpperCase();

  if (["SUCCESS", "PAID", "COMPLETED", "SETTLEMENT", "00"].includes(status)) return "paid";
  if (["EXPIRED", "TIMEOUT"].includes(status)) return "expired";
  if (["CANCELLED", "CANCELED", "VOIDED"].includes(status)) return "cancelled";
  if (["FAILED", "DENIED"].includes(status)) return "failed";
  return "pending";
};

export const mapDokuVaStatus = (resp: AnyRecord): "pending" | "paid" | "failed" | "expired" | "cancelled" => {
  const reasonEn = String(resp?.virtualAccountData?.paymentFlagReason?.english || "").toUpperCase();
  const reasonId = String(resp?.virtualAccountData?.paymentFlagReason?.indonesia || "").toUpperCase();
  const responseCode = String(resp?.responseCode || "");

  if (responseCode.startsWith("200")) {
    if (reasonEn.includes("PENDING") || reasonId.includes("BELUM")) return "pending";
    if (reasonEn.includes("PAID") || reasonEn.includes("SUCCESS") || reasonId.includes("LUNAS")) return "paid";
    return "pending";
  }
  if (responseCode.startsWith("404")) return "expired";
  if (responseCode.startsWith("401") || responseCode.startsWith("403")) return "failed";
  return "pending";
};
