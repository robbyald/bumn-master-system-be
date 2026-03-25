import { createRequire } from "node:module";
import { env } from "../env.js";
const require = createRequire(import.meta.url);
const decodePem = (value) => value.replace(/\\n/g, "\n");
const getSdk = () => {
    try {
        return require("doku-nodejs-library");
    }
    catch {
        throw new Error("DOKU SDK belum terpasang. Jalankan: npm i doku-nodejs-library");
    }
};
export const ensureDokuConfig = () => {
    if (!env.DOKU_CLIENT_ID || !env.DOKU_SECRET_KEY || !env.DOKU_PRIVATE_KEY) {
        throw new Error("DOKU config belum lengkap. Wajib isi DOKU_CLIENT_ID, DOKU_SECRET_KEY, dan DOKU_PRIVATE_KEY.");
    }
};
export const createDokuClient = () => {
    ensureDokuConfig();
    const sdk = getSdk();
    const Snap = sdk?.Snap;
    if (typeof Snap !== "function") {
        throw new Error("DOKU SDK tidak valid: class Snap tidak ditemukan.");
    }
    return new Snap({
        isProduction: env.DOKU_ENV === "production",
        privateKey: decodePem(env.DOKU_PRIVATE_KEY),
        clientID: env.DOKU_CLIENT_ID,
        publicKey: env.DOKU_PUBLIC_KEY ? decodePem(env.DOKU_PUBLIC_KEY) : "",
        dokuPublicKey: env.DOKU_PUBLIC_KEY_DOKU ? decodePem(env.DOKU_PUBLIC_KEY_DOKU) : "",
        issuer: env.DOKU_ISSUER || undefined,
        secretKey: env.DOKU_SECRET_KEY,
    });
};
export const buildPaymentJumpAppRequest = (payload) => {
    const PaymentJumpAppRequestDto = require("doku-nodejs-library/_models/paymentJumpAppRequestDTO");
    const req = new PaymentJumpAppRequestDto();
    req.partnerReferenceNo = payload.partnerReferenceNo;
    req.pointOfInitiation = "Mobile App";
    req.urlParam = [{ url: payload.returnUrl, type: "PAY_RETURN", isDeepLink: "N" }];
    req.amount = { value: payload.amountValue.toFixed(2), currency: "IDR" };
    req.additionalInfo = {
        channel: env.DOKU_CHANNEL,
        orderTitle: payload.orderTitle,
        supportDeepLinkCheckoutUrl: "false",
    };
    req.validUpTo = payload.validUpToIso;
    return req;
};
export const buildCheckStatusRequest = (payload) => {
    const CheckStatusDirectDebitDTO = require("doku-nodejs-library/_models/checkStatusDirectDebitRequestDTO");
    const req = new CheckStatusDirectDebitDTO();
    req.originalPartnerReferenceNo = payload.originalPartnerReferenceNo;
    req.serviceCode = "55";
    req.transactionDate = payload.transactionDateIso || new Date().toISOString();
    req.amount = { value: payload.amountValue.toFixed(2), currency: "IDR" };
    req.additionalInfo = { channel: env.DOKU_CHANNEL };
    return req;
};
export const dokuDoPaymentJumpApp = async (doku, requestDto, ipAddress, deviceId = "") => {
    if (typeof doku?.doPaymentJumpApp !== "function") {
        throw new Error("Method doPaymentJumpApp tidak tersedia di DOKU SDK.");
    }
    return doku.doPaymentJumpApp(requestDto, ipAddress, deviceId);
};
export const dokuDoCheckStatus = async (doku, requestDto) => {
    if (typeof doku?.doCheckStatus !== "function") {
        throw new Error("Method doCheckStatus tidak tersedia di DOKU SDK.");
    }
    return doku.doCheckStatus(requestDto);
};
export const extractCheckoutUrl = (resp) => {
    const candidates = [
        resp?.webRedirectUrl,
        resp?.response?.webRedirectUrl,
        resp?.redirect_url,
        resp?.checkout_url,
    ];
    return candidates.find((v) => typeof v === "string" && v.length > 0) || null;
};
export const extractInvoiceNumber = (resp) => {
    const candidates = [
        resp?.partnerReferenceNo,
        resp?.originalPartnerReferenceNo,
        resp?.invoice_number,
        resp?.response?.partnerReferenceNo,
    ];
    return candidates.find((v) => typeof v === "string" && v.length > 0) || null;
};
export const mapDokuStatus = (resp) => {
    const raw = resp?.latestTransactionStatus ||
        resp?.transactionStatusDesc ||
        resp?.status ||
        resp?.response?.status ||
        "";
    const status = String(raw).toUpperCase();
    if (["SUCCESS", "PAID", "COMPLETED", "SETTLEMENT", "00"].includes(status))
        return "paid";
    if (["EXPIRED", "TIMEOUT"].includes(status))
        return "expired";
    if (["CANCELLED", "CANCELED", "VOIDED"].includes(status))
        return "cancelled";
    if (["FAILED", "DENIED"].includes(status))
        return "failed";
    return "pending";
};
