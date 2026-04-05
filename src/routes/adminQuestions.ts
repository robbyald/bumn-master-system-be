import { Router } from "express";
import { z } from "zod";
import { readFileSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { db } from "../db/index.js";
import { questionBank, questionUsage, latsolSetQuestion } from "../db/schema.js";
import { eq, and, sql, or, like } from "drizzle-orm";
import { env } from "../env.js";
import { randomUUID, createHash } from "node:crypto";
import multer from "multer";

const router = Router();

const questionImageDir = join(process.cwd(), "uploads", "question-bank");
try {
  mkdirSync(questionImageDir, { recursive: true });
} catch {
  // ignore
}

const questionImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, questionImageDir),
    filename: (_req, file, cb) => {
      const safeExt = extname(file.originalname || "").toLowerCase() || ".png";
      cb(null, `question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const ocrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const mimeFromExt = (ext: string) => {
  const e = ext.toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  return "image/png";
};


type ValidationIssue = { code: string; message: string };
type ValidationResult = {
  is_valid: boolean;
  verdict: "valid" | "invalid";
  issues: ValidationIssue[];
  explanation: string;
};

const validatorSchema = {
  name: "question_validation",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      is_valid: { type: "boolean" },
      verdict: { type: "string", enum: ["valid", "invalid"] },
      issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            code: { type: "string" },
            message: { type: "string" }
          },
          required: ["code", "message"]
        }
      },
      explanation: { type: "string" }
    },
    required: ["is_valid", "verdict", "issues", "explanation"]
  },
  strict: true
} as const;

const buildInvalid = (issues: ValidationIssue[], explanation: string): ValidationResult => ({
  is_valid: false,
  verdict: "invalid",
  issues,
  explanation
});

const extractInts = (text: string) =>
  (text.match(/\d+/g) || []).map((n) => Number(n));

const ruleBasedValidateVlr = (input: {
  context_text?: string;
  statement_to_judge?: string;
  correctAnswer?: string;
  explanation?: string;
}): ValidationResult | null => {
  const ctx = (input.context_text || "").trim();
  const stmt = (input.statement_to_judge || "").trim();
  const explanation = (input.explanation || "").trim();
  const correctAnswer = (input.correctAnswer || "").toUpperCase();

  const forbiddenContextPhrases =
    /(oleh karena itu|dengan demikian|dapat disimpulkan|kesimpulannya|sehingga dapat)/i;
  if (forbiddenContextPhrases.test(ctx)) {
    return buildInvalid(
      [{ code: "SPOILER_IN_CONTEXT", message: "Context mengandung kata kesimpulan." }],
      "Context harus murni data/fakta. Ditemukan kata kesimpulan dalam context_text."
    );
  }

  const ctxNorm = ctx.toLowerCase().replace(/\s+/g, " ").trim();
  const stmtNorm = stmt.toLowerCase().replace(/\s+/g, " ").trim();
  if (stmtNorm && ctxNorm.includes(stmtNorm)) {
    return buildInvalid(
      [{ code: "SPOILER_IN_CONTEXT", message: "Statement muncul di dalam context." }],
      "Statement tidak boleh diulang di dalam context_text karena menjadi spoiler."
    );
  }

  const hasAllStatement = /\bsemua\b/i.test(stmt);
  const hasRemainderGroup = /(sisa|sisanya|lainnya|kelompok lain|kategori lain|lain-lain)/i.test(ctx);
  const remainderHasStatus = /(sisanya|sisa|lainnya|kelompok lain|kategori lain)[^.]*\b(juga\s+)?(mendapatkan|tidak mendapatkan|berhak|tidak berhak|wajib|tidak wajib)\b/i.test(ctx);
  if (hasAllStatement && hasRemainderGroup && !remainderHasStatus) {
    return buildInvalid(
      [{ code: "INCOMPLETE_CATEGORY", message: "Kategori sisa/lainnya tidak memiliki status atribut." }],
      "Statement memakai kata 'semua', tetapi context menyebut kelompok sisa tanpa status atribut. Kesimpulan tidak bisa dipastikan."
    );
  }

  const explLower = explanation.toLowerCase();
  if (explLower.includes("dalam konteks soal ini") || explLower.includes("diasumsikan") || explLower.includes("dianggap")) {
    return buildInvalid(
      [{ code: "HALLUCINATION", message: "Explanation menambah asumsi di luar context." }],
      "Explanation menggunakan asumsi di luar teks (kata seperti 'diasumsikan' / 'dalam konteks soal ini')."
    );
  }

  const stmtNums = extractInts(stmt);
  const explNums = extractInts(explanation);
  const mathCue = /(jumlah|total|selisih|lebih dari|kurang dari|sisa|persen|%|hasil|perbandingan)/i;
  const opCue = /[=+\-*/]/;
  const hasMathEvidence =
    (mathCue.test(stmt) || mathCue.test(explanation) || opCue.test(explanation)) &&
    stmtNums.length > 0 &&
    explNums.length > 0;
  const lastExplNum = explNums.length ? explNums[explNums.length - 1] : null;

  const ctxNums = extractInts(ctx);
  const mentionsAtLeastOne = /(setidaknya salah satu|minimal salah satu|seluruh .*setidaknya salah satu)/i.test(ctx);
  if (mentionsAtLeastOne && ctxNums.length >= 3) {
    const total = ctxNums[0];
    const groupA = ctxNums[1];
    const groupB = ctxNums[2];
    if (groupA + groupB < total) {
      return buildInvalid(
        [{ code: "MATH_ERROR", message: "Jumlah peserta dua kelompok kurang dari total, bertentangan dengan klaim setidaknya satu." }],
        "Konteks menyatakan semua mengikuti minimal satu pelatihan, tetapi jumlah dua kelompok lebih kecil dari total."
      );
    }
  }

  if (hasMathEvidence && lastExplNum !== null) {
    if (correctAnswer === "A" && stmtNums[0] !== lastExplNum) {
      return buildInvalid(
        [{ code: "WRONG_KEY", message: "Hasil hitung tidak sama dengan angka pada statement, tetapi jawaban A." }],
        "Explanation menghitung nilai yang berbeda dari statement, namun kunci jawaban menyatakan benar."
      );
    }
    if (correctAnswer === "B" && stmtNums[0] === lastExplNum) {
      return buildInvalid(
        [{ code: "WRONG_KEY", message: "Hasil hitung sama dengan statement, tetapi jawaban B." }],
        "Explanation mendukung statement, tetapi kunci jawaban menyatakan salah."
      );
    }
  }

  if (explLower.includes("simpulan adalah benar") && correctAnswer !== "A") {
    return buildInvalid(
      [{ code: "WRONG_KEY", message: "Explanation menyebut benar, tetapi correctAnswer bukan A." }],
      "Penjelasan menyebut simpulan benar, namun correctAnswer tidak konsisten."
    );
  }
  if (explLower.includes("simpulan adalah salah") && correctAnswer !== "B") {
    return buildInvalid(
      [{ code: "WRONG_KEY", message: "Explanation menyebut salah, tetapi correctAnswer bukan B." }],
      "Penjelasan menyebut simpulan salah, namun correctAnswer tidak konsisten."
    );
  }
  if (explLower.includes("tidak dapat disimpulkan") && correctAnswer !== "C") {
    return buildInvalid(
      [{ code: "WRONG_KEY", message: "Explanation menyebut tidak dapat disimpulkan, tetapi correctAnswer bukan C." }],
      "Penjelasan menyebut tidak dapat disimpulkan, namun correctAnswer tidak konsisten."
    );
  }

  const headMatches = Array.from(
    ctx.matchAll(/(\d+)\s+([A-Za-zÀ-ÿ]+)\s+[A-Za-zÀ-ÿ]+/g)
  );
  const hasCategoryHint = /(jenis|tipe|kategori|paket)/i.test(ctx);
  if (hasCategoryHint && headMatches.length >= 2) {
    const headMap = new Map<string, number>();
    for (const m of headMatches) {
      const num = Number(m[1]);
      const head = m[2].toLowerCase();
      headMap.set(head, (headMap.get(head) || 0) + num);
    }

    for (const [head, sum] of headMap.entries()) {
      const regex = new RegExp(`jumlah\\s+${head}\\b[^\\d]*(\\d+)`, "i");
      const m = explanation.match(regex);
      if (m) {
        const stated = Number(m[1]);
        if (stated !== sum) {
          return buildInvalid(
            [{ code: "MATH_ERROR", message: "Jumlah pada explanation tidak sesuai dengan data konteks." }],
            `Penjelasan menyebut jumlah ${head} = ${stated}, tetapi penjumlahan data konteks menghasilkan ${sum}.`
          );
        }
      }
    }
  }

  return null;
};

const validateWithAI = async (params: {
  category: string;
  subcategory: string;
  difficulty: string;
  usageType: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  context_text?: string;
  statement_to_judge?: string;
}): Promise<ValidationResult | null> => {
  if (!env.OPENAI_API_KEY || !env.OPENAI_VALIDATOR_MODEL) {
    return null;
  }

  const isVlr = params.subcategory === "Verbal Logical Reasoning";
  const system = isVlr
    ? [
        "Anda adalah Senior Quality Assurance (Validator) khusus untuk soal tes TKD (Verbal Logical Reasoning) dan AKHLAK bergaya BUMN.",
        "Tugas utama Anda: Mengevaluasi apakah komponen soal (context, statement, options, kunci jawaban, dan pembahasan) saling sinkron, logis, dan tidak menyesatkan.",
        "",
        "ATURAN MUTLAK VALIDASI VLR (CRITICAL):",
        "1. PAHAMI KARAKTERISTIK KUNCI JAWABAN:",
        "   - Jika 'statement' BERTENTANGAN dengan 'context', soal ini VALID, asalkan 'correctAnswer' adalah 'B' (Simpulan adalah salah). JANGAN me-reject soal hanya karena pernyataannya kontradiksi!",
        "   - Jika 'statement' MENGGUNAKAN ASUMSI LUAR yang tidak ada di 'context', soal ini VALID, asalkan 'correctAnswer' adalah 'C' (Tidak dapat disimpulkan).",
        "   - Jika 'statement' 100% SELARAS dengan 'context', soal ini VALID, asalkan 'correctAnswer' adalah 'A' (Simpulan adalah benar).",
        "",
        "2. KRITERIA REJECT MUTLAK (Nyatakan INVALID jika terjadi salah satu di bawah ini):",
        "   - [WRONG_KEY]: Kunci jawaban (correctAnswer) tidak sesuai dengan logika deduktif yang sebenarnya.",
        "   - [MATH_ERROR]: Hitungan matematika di 'explanation' salah, tidak masuk akal, atau menggunakan data yang bertabrakan dengan fakta di 'context'.",
        "   - [SPOILER_IN_CONTEXT]: Terdapat kata-kata kesimpulan di dalam 'context_text' (contoh: 'Maka', 'Oleh karena itu', 'Dapat disimpulkan', 'Sehingga').",
        "   - [HALLUCINATION]: Bagian 'explanation' membenarkan/menyalahkan pernyataan menggunakan asumsi di luar 'context_text'.",
        "",
        "3. FORMAT EVALUASI:",
        "   - Lakukan pengecekan selangkah demi selangkah.",
        "   - Jika ada kesalahan, jelaskan tepat letak cacat logikanya.",
        "   - Jika soal valid dan logikanya sempurna, berikan pujian singkat dan nyatakan soal siap dipakai."
      ].join("\n")
    : [
        "Anda adalah validator soal TKD/AKHLAK.",
        "Tugas: menilai apakah soal valid, tidak menyesatkan, dan logikanya konsisten.",
        "Jika ada kesalahan logika, matematika, atau asumsi di luar teks, nyatakan INVALID.",
        "Berikan penjelasan rinci tentang letak kesalahan atau alasan valid."
      ].join("\n");

  const user = JSON.stringify({
    category: params.category,
    subcategory: params.subcategory,
    difficulty: params.difficulty,
    usageType: params.usageType,
    question: params.question,
    context_text: params.context_text,
    statement_to_judge: params.statement_to_judge,
    options: params.options,
    correctAnswer: params.correctAnswer,
    explanation: params.explanation
  });

  const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: env.OPENAI_VALIDATOR_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      response_format: { type: "json_schema", json_schema: validatorSchema }
    })
  });

  if (!aiRes.ok) {
    return null;
  }

  const data = (await aiRes.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    return JSON.parse(content) as ValidationResult;
  } catch {
    return null;
  }
};

const fixWithAI = async (params: {
  category: string;
  subcategory: string;
  difficulty: string;
  usageType: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  context_text?: string;
  statement_to_judge?: string;
  validationDetail?: ValidationResult | null;
}): Promise<
  | {
      question?: string;
      context_text?: string;
      statement_to_judge?: string;
      options: string[];
      correctAnswer: "A" | "B" | "C" | "D" | "E";
      explanation: string;
    }
  | null
> => {
  if (!env.OPENAI_API_KEY || !env.OPENAI_VALIDATOR_MODEL) {
    return null;
  }

  const isVlr = params.subcategory === "Verbal Logical Reasoning";
  const system = [
    "Anda adalah editor soal.",
    "Tugas: perbaiki soal agar valid dan tidak menyesatkan.",
    "Lakukan perubahan seminimal mungkin pada teks, angka, atau jawaban.",
    "Jika ada kategori 'sisa/lainnya' tanpa status atribut, lengkapi statusnya atau ubah jawaban menjadi C.",
    "Hindari asumsi di luar teks. Pastikan penjelasan konsisten dengan jawaban."
  ].join("\n");

  const user = JSON.stringify({
    category: params.category,
    subcategory: params.subcategory,
    difficulty: params.difficulty,
    usageType: params.usageType,
    question: params.question,
    context_text: params.context_text,
    statement_to_judge: params.statement_to_judge,
    options: params.options,
    correctAnswer: params.correctAnswer,
    explanation: params.explanation,
    validationDetail: params.validationDetail ?? null
  });

  const isAkhlaq = params.category === "AKHLAK";
  const schema = isVlr
    ? ({
        name: "tkd_vlr_fix",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            context_text: { type: "string" },
            statement_to_judge: { type: "string" },
            options: {
              type: "array",
              items: { type: "string" },
              minItems: 3,
              maxItems: 3
            },
            correctAnswer: { type: "string", enum: ["A", "B", "C"] },
            explanation: { type: "string" }
          },
          required: ["context_text", "statement_to_judge", "options", "correctAnswer", "explanation"]
        },
        strict: true
      } as const)
    : ({
        name: "question_fix",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            options: {
              type: "array",
              items: { type: "string" },
              minItems: isAkhlaq ? 4 : 3,
              maxItems: isAkhlaq ? 4 : 5
            },
            correctAnswer: {
              type: "string",
              enum: isAkhlaq ? ["A", "B", "C", "D"] : ["A", "B", "C", "D", "E"]
            },
            explanation: { type: "string" }
          },
          required: ["question", "options", "correctAnswer", "explanation"]
        },
        strict: true
      } as const);

  const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: env.OPENAI_VALIDATOR_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      response_format: { type: "json_schema", json_schema: schema }
    })
  });

  if (!aiRes.ok) {
    return null;
  }

  const data = (await aiRes.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const blueprints: Record<string, string> = {
  "Number Sequence": readFileSync(
    resolve("prompts/tkd-number-sequence-blueprint.md"),
    "utf-8"
  ),
  "Word Classification": readFileSync(
    resolve("prompts/tkd-word-classification-blueprint.md"),
    "utf-8"
  ),
  "Verbal Logical Reasoning": readFileSync(
    resolve("prompts/tkd-verbal-blueprint.md"),
    "utf-8"
  ),
  Amanah: readFileSync(resolve("prompts/akhlak-amanah-blueprint.md"), "utf-8")
  ,
  Kompeten: readFileSync(resolve("prompts/akhlak-kompeten-blueprint.md"), "utf-8"),
  Harmonis: readFileSync(resolve("prompts/akhlak-harmonis-blueprint.md"), "utf-8"),
  Loyal: readFileSync(resolve("prompts/akhlak-loyal-blueprint.md"), "utf-8"),
  Adaptif: readFileSync(resolve("prompts/akhlak-adaptif-blueprint.md"), "utf-8"),
  Kolaboratif: readFileSync(resolve("prompts/akhlak-kolaboratif-blueprint.md"), "utf-8")
};

type VlrGold = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  pattern?: string;
};

const loadVlrGoldset = (): VlrGold[] => {
  try {
    const raw = readFileSync(resolve("data/goldset/tkd-verbal.json"), "utf-8");
    const parsed = JSON.parse(raw) as VlrGold[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const pickVlrExamples = (count: number): VlrGold[] => {
  const items = loadVlrGoldset();
  if (items.length === 0) return [];
  const groups = new Map<string, VlrGold[]>();
  for (const q of items) {
    const key = q.pattern || "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(q);
  }
  const patterns = Array.from(groups.keys());
  const selected: VlrGold[] = [];
  const shuffledPatterns = patterns.sort(() => Math.random() - 0.5);
  for (const p of shuffledPatterns) {
    const arr = groups.get(p)!;
    if (arr.length === 0) continue;
    selected.push(arr[Math.floor(Math.random() * arr.length)]);
    if (selected.length >= count) break;
  }
  while (selected.length < count) {
    selected.push(items[Math.floor(Math.random() * items.length)]);
  }
  return selected;
};

const pickVlrPattern = (): string => {
  const items = loadVlrGoldset();
  const patterns = Array.from(new Set(items.map((q) => q.pattern || "ambiguitas")));
  if (patterns.length === 0) return "ambiguitas";
  return patterns[Math.floor(Math.random() * patterns.length)];
};

const deriveContextTitle = (ctx: string): string => {
  const lines = ctx
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const first = lines[0] || "";
  const heading = first.match(/^KONTEN\s*(?:[IVXLC]+|\d+)?\s*[:\-]\s*(.+)$/i);
  if (heading?.[1]) return heading[1].trim();
  const words = first.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 4);
  if (words.length) return words.join(" ");
  return "Konteks Soal";
};

const buildSharedContextDetail = (ctx: string): string => {
  const normalized = ctx.trim().toLowerCase();
  const grp = createHash("sha1").update(normalized).digest("hex").slice(0, 10).toUpperCase();
  const title = deriveContextTitle(ctx);
  return `AI Shared Context | KONTEN: ${title} | GRP:${grp}`;
};

const deriveOcrContextTitle = (question: string): string | null => {
  const text = String(question || "");
  const heading = text.match(/^KONTEN\s*(?:[IVXLC]+|\d+)?\s*[:\-]\s*(.+)$/im);
  if (!heading?.[1]) return null;
  return heading[1].trim() || null;
};

const buildOcrGroupedDetail = (title: string): string => {
  const base = title.trim().toLowerCase();
  const grp = createHash("sha1").update(`ocr|${base}`).digest("hex").slice(0, 10).toUpperCase();
  return `OCR Import | KONTEN: ${title} | GRP:${grp}`;
};

const ensureOcrSourceDetailGroup = (sourceDetail: string, question: string): string => {
  const raw = String(sourceDetail || "").trim();
  if (!raw) return raw;
  if (/GRP:[A-Z0-9]+/i.test(raw)) return raw;
  const title = deriveOcrContextTitle(question);
  if (!title) return raw;
  if (/OCR Import/i.test(raw)) {
    return `${raw} | KONTEN: ${title} | GRP:${createHash("sha1").update(`ocr|${title.trim().toLowerCase()}`).digest("hex").slice(0, 10).toUpperCase()}`;
  }
  return raw;
};

const generateSchema = z.object({
  category: z.enum(["TKD", "AKHLAK"]).default("TKD"),
  subcategory: z.enum([
    "Number Sequence",
    "Word Classification",
    "Verbal Logical Reasoning",
    "Amanah",
    "Kompeten",
    "Harmonis",
    "Loyal",
    "Adaptif",
    "Kolaboratif"
  ]).default("Word Classification"),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  usageType: z.enum(["practice", "tryout"]).default("practice"),
  save: z.boolean().optional().default(true),
  validate: z.boolean().optional().default(true),
  sharedContext: z.boolean().optional().default(false),
  contextText: z.string().optional(),
  usedStatements: z.array(z.string()).optional().default([])
});

const saveSchema = z.object({
  category: z.enum(["TKD", "AKHLAK"]),
  subcategory: z.enum([
    "Number Sequence",
    "Word Classification",
    "Verbal Logical Reasoning",
    "Amanah",
    "Kompeten",
    "Harmonis",
    "Loyal",
    "Adaptif",
    "Kolaboratif"
  ]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  usageType: z.enum(["practice", "tryout"]),
  question: z.string().min(1),
  options: z.array(z.string().min(1)),
  correctAnswer: z.string().min(1),
  explanation: z.string().min(1),
  source: z.enum(["ai", "ocr"]).optional().default("ai"),
  sourceDetail: z.string().optional().default(""),
  imageUrl: z.string().optional(),
  imagePosition: z.enum(["top", "bottom"]).optional().default("bottom"),
  sharedContext: z.boolean().optional().default(false)
});

const appendImageMeta = (sourceDetail: string, imageUrl?: string, imagePosition: "top" | "bottom" = "bottom") => {
  const clean = String(sourceDetail || "")
    .replace(/\s*\|\s*IMG:[^|]+/gi, "")
    .replace(/\s*\|\s*IMG_POS:[^|]+/gi, "")
    .trim();
  if (!imageUrl) return clean;
  const posTag = `IMG_POS:${imagePosition}`;
  return clean ? `${clean} | IMG:${imageUrl} | ${posTag}` : `IMG:${imageUrl} | ${posTag}`;
};

const appendImageToQuestion = (question: string, imageUrl?: string) => {
  const clean = String(question || "").replace(/\n{2,}\[IMAGE\]\s+\S+\s*$/i, "").trim();
  if (!imageUrl) return clean;
  return clean;
};

const prettifyOcrQuestion = (raw: string) => {
  let text = String(raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  // Split inline dash facts into separate lines to improve readability.
  text = text.replace(/\s-\s+/g, "\n- ");
  // Convert dash list markers to bullet markers.
  text = text.replace(/(^|\n)-\s+/g, "$1• ");
  // Collapse excessive blank lines.
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
};

const extractOptionsFromQuestionText = (rawQuestion: string) => {
  const lines = String(rawQuestion || "").split("\n");
  const options: string[] = [];
  const kept: string[] = [];
  for (const line of lines) {
    const m = line.trim().match(/^([A-Ea-e])\.\s*(.+)$/);
    if (m?.[2]) {
      options.push(String(m[2]).trim());
    } else {
      kept.push(line);
    }
  }
  return {
    question: kept.join("\n").trim(),
    options,
  };
};

const validateSchema = z.object({
  category: z.enum(["TKD", "AKHLAK"]),
  subcategory: z.enum([
    "Number Sequence",
    "Word Classification",
    "Verbal Logical Reasoning",
    "Amanah",
    "Kompeten",
    "Harmonis",
    "Loyal",
    "Adaptif",
    "Kolaboratif"
  ]),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  usageType: z.enum(["practice", "tryout"]).default("practice"),
  question: z.string().min(1),
  context_text: z.string().optional(),
  statement_to_judge: z.string().optional(),
  options: z.array(z.string().min(1)),
  correctAnswer: z.string().min(1),
  explanation: z.string().min(1)
});

const autoFixSchema = validateSchema.extend({
  save: z.boolean().optional().default(false),
  validationDetail: z.any().optional()
});

router.post("/", async (req, res) => {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }
  const {
    category,
    subcategory,
    difficulty,
    usageType,
    question,
    options,
    correctAnswer,
    explanation,
    source,
    sourceDetail,
    imageUrl,
    imagePosition,
    sharedContext,
  } = parsed.data;
  let derivedSourceDetail = sourceDetail || "";
  if (!derivedSourceDetail && sharedContext && subcategory === "Verbal Logical Reasoning") {
    const [ctx] = String(question || "").split(/\n\n+/);
    if ((ctx || "").trim()) {
      derivedSourceDetail = buildSharedContextDetail((ctx || "").trim());
    }
  }
  if (source === "ocr") {
    if (!derivedSourceDetail) {
      const title = deriveOcrContextTitle(question);
      derivedSourceDetail = title ? buildOcrGroupedDetail(title) : "OCR Import";
    } else {
      derivedSourceDetail = ensureOcrSourceDetailGroup(derivedSourceDetail, question);
    }
  }
  derivedSourceDetail = appendImageMeta(derivedSourceDetail, imageUrl, imagePosition);
  const baseQuestion = source === "ocr" ? prettifyOcrQuestion(question) : question;
  const finalQuestion = appendImageToQuestion(baseQuestion, imageUrl);
  const id = randomUUID();
  await db.insert(questionBank).values({
    id,
    category,
    subcategory,
    difficulty,
    usageType,
    question: finalQuestion,
    options: JSON.stringify(options),
    correctAnswer,
    explanation,
    source: source || "ai",
    sourceDetail: derivedSourceDetail,
    status: "draft"
  });
  return res.status(201).json({ id });
});

router.post("/upload-image", questionImageUpload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Image file is required." });
  }
  const imageUrl = `/uploads/question-bank/${req.file.filename}`;
  return res.json({ imageUrl });
});

router.post("/enhance-image", async (req, res) => {
  const imageUrl = String(req.body?.imageUrl || "").trim();
  if (!imageUrl || !imageUrl.startsWith("/uploads/question-bank/")) {
    return res.status(400).json({ message: "imageUrl tidak valid." });
  }
  if (!env.OPENAI_API_KEY) {
    return res.status(500).json({ message: "OPENAI_API_KEY belum di-set." });
  }

  try {
    const filePath = resolve(process.cwd(), `.${imageUrl}`);
    const ext = extname(filePath) || ".png";
    const mime = mimeFromExt(ext);
    const raw = await readFile(filePath);
    const runEdit = async (model: string) => {
      const form = new FormData();
      form.append("model", model);
      form.append(
        "prompt",
        "Perjelas gambar soal agar teks/angka lebih tajam dan terbaca. Pertahankan isi, layout, urutan angka, opsi, dan struktur asli. Jangan menambah atau menghapus elemen.",
      );
      form.append("size", "1024x1024");
      form.append("response_format", "b64_json");
      form.append("image", new Blob([raw], { type: mime }), `input${ext}`);

      const aiRes = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: form,
      });
      const aiBody = (await aiRes.json().catch(() => ({}))) as any;
      return { ok: aiRes.ok, body: aiBody };
    };

    const preferredModel = String(env.OPENAI_IMAGE_MODEL || "dall-e-2").trim();
    let modelUsed = preferredModel;
    let result = await runEdit(preferredModel);

    const isInvalidModel = !result.ok && String(result.body?.error?.param || "") === "model";
    if (isInvalidModel && preferredModel !== "dall-e-2") {
      modelUsed = "dall-e-2";
      result = await runEdit(modelUsed);
    }

    if (!result.ok) {
      return res.status(502).json({
        message: "Gagal enhance image via AI.",
        details: result.body,
      });
    }

    const b64 = result.body?.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(502).json({ message: "AI tidak mengembalikan image result." });
    }

    const enhancedBuffer = Buffer.from(String(b64), "base64");
    const enhancedFile = `question-enhanced-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    await writeFile(join(questionImageDir, enhancedFile), enhancedBuffer);

    return res.json({
      imageUrl: `/uploads/question-bank/${enhancedFile}`,
      model: modelUsed,
    });
  } catch (err: any) {
    return res.status(500).json({
      message: err?.message || "Gagal enhance image.",
    });
  }
});

router.post("/ocr-extract", ocrUpload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Image file is required." });
  }
  if (!env.OPENAI_API_KEY || !env.OPENAI_VISION_MODEL) {
    return res.status(500).json({ message: "OPENAI_API_KEY/OPENAI_VISION_MODEL not configured." });
  }

  const category = String(req.body?.category || "TKD");
  const subcategory = String(req.body?.subcategory || "Verbal Logical Reasoning");
  const difficulty = String(req.body?.difficulty || "medium");
  const usageType = String(req.body?.usageType || "practice");

  const imageMime = req.file.mimetype || "image/jpeg";
  const base64Image = req.file.buffer.toString("base64");
  const dataUrl = `data:${imageMime};base64,${base64Image}`;

  const schema = {
    name: "ocr_question_extract",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              question: { type: "string" },
              options: {
                type: "array",
                minItems: 2,
                items: { type: "string" },
              },
              correctAnswer: { type: "string" },
              explanation: { type: "string" },
            },
            required: ["question", "options", "correctAnswer", "explanation"],
          },
        },
      },
      required: ["items"],
    },
    strict: true,
  } as const;

  const systemPrompt = [
    "Anda adalah OCR parser soal pilihan ganda Bahasa Indonesia.",
    "Ekstrak soal dari gambar menjadi format JSON yang valid.",
    "Hapus teks label yang tidak relevan seperti '(TKD BUMN 2025)'.",
    "Pertahankan struktur baris. Jika ada poin fakta berawalan '-', pecah per baris dan ubah menjadi bullet point.",
    "Jika jawaban benar tidak terlihat di gambar, isi correctAnswer dengan string kosong.",
    "Jika pembahasan tidak ada, isi explanation dengan string kosong.",
    "Pastikan opsi hanya berisi isi kalimat tanpa awalan 'A.'/'B.' dst.",
    "Kembalikan seluruh soal yang terlihat di gambar.",
  ].join(" ");

  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_VISION_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Ekstrak soal pilihan ganda dari gambar berikut." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        response_format: { type: "json_schema", json_schema: schema },
      }),
    });

    if (!aiRes.ok) {
      const errBody = await aiRes.json().catch(() => ({}));
      return res.status(502).json({
        message: "OCR request failed",
        details: errBody,
      });
    }

    const data = (await aiRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(502).json({ message: "OCR result is empty." });
    }

    const parsed = JSON.parse(content) as {
      items: Array<{
        question: string;
        options: string[];
        correctAnswer: string;
        explanation: string;
      }>;
    };

    const cleaned = [] as Array<{
      id: string;
      category: string;
      subcategory: string;
      difficulty: string;
      usageType: string;
      question: string;
      options: string[];
      correctAnswer: string;
      explanation: string;
      source: "ocr";
      sourceDetail: string;
    }>;

    for (const item of parsed.items || []) {
      let question = prettifyOcrQuestion(String(item.question || "").trim());
      let options = (item.options || [])
        .map((opt) => String(opt || "").replace(/^[A-E]\.?\s*/i, "").trim())
        .filter(Boolean);

      if (options.length < 2) {
        const extracted = extractOptionsFromQuestionText(question);
        if (extracted.options.length >= 2) {
          question = extracted.question;
          options = extracted.options;
        }
      }
      let correctAnswer = String(item.correctAnswer || "").trim().toUpperCase().slice(0, 1);
      let explanation = String(item.explanation || "").trim();

      const hasValidAnswer = /^[A-E]$/.test(correctAnswer);
      if ((!hasValidAnswer || !explanation) && question && options.length >= 2) {
        const solvePrompt = [
          "Jawab soal pilihan ganda berikut.",
          "Kembalikan JSON dengan format:",
          '{"correctAnswer":"A","explanation":"..."}',
          "correctAnswer wajib hanya 1 huruf A/B/C/D/E.",
          "Penjelasan harus singkat dan langsung.",
        ].join(" ");

        const solveRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: env.OPENAI_MODEL,
            messages: [
              { role: "system", content: solvePrompt },
              {
                role: "user",
                content: JSON.stringify({ question, options }),
              },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "ocr_solved_answer",
                strict: true,
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    correctAnswer: { type: "string" },
                    explanation: { type: "string" },
                  },
                  required: ["correctAnswer", "explanation"],
                },
              },
            },
          }),
        });

        if (solveRes.ok) {
          const solveBody = (await solveRes.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const solveContent = solveBody.choices?.[0]?.message?.content;
          if (solveContent) {
            const solved = JSON.parse(solveContent) as { correctAnswer?: string; explanation?: string };
            correctAnswer = String(solved.correctAnswer || correctAnswer).trim().toUpperCase().slice(0, 1);
            explanation = String(solved.explanation || explanation).trim();
          }
        }
      }

      cleaned.push({
        id: randomUUID(),
        category,
        subcategory,
        difficulty,
        usageType,
        question,
        options,
        correctAnswer,
        explanation,
        source: "ocr",
        sourceDetail: "",
      });
    }

    const groupedByTitle = new Map<string, number[]>();
    for (let i = 0; i < cleaned.length; i++) {
      const current = cleaned[i];
      if (!current) continue;
      const title = deriveOcrContextTitle(current.question);
      if (!title) continue;
      const key = title.trim().toLowerCase();
      if (!groupedByTitle.has(key)) groupedByTitle.set(key, []);
      groupedByTitle.get(key)!.push(i);
    }
    for (const [, indexes] of groupedByTitle.entries()) {
      const firstIdx = indexes[0];
      if (typeof firstIdx !== "number") continue;
      const first = cleaned[firstIdx];
      if (!first) continue;
      const title = deriveOcrContextTitle(first.question);
      if (!title) continue;
      const detail = indexes.length > 1 ? buildOcrGroupedDetail(title) : "OCR Import";
      for (const idx of indexes) {
        const target = cleaned[idx];
        if (target) target.sourceDetail = detail;
      }
    }
    for (const item of cleaned) {
      if (!item.sourceDetail) item.sourceDetail = "OCR Import";
    }

    return res.json({
      items: cleaned,
      imageUrl: null,
    });
  } catch (err: any) {
    return res.status(500).json({
      message: err?.message || "Failed to process OCR.",
    });
  }
});

router.post("/validate", async (req, res) => {
  const parsed = validateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }

  if (!env.OPENAI_API_KEY || !env.OPENAI_VALIDATOR_MODEL) {
    return res.status(500).json({ message: "OPENAI_API_KEY/OPENAI_VALIDATOR_MODEL not configured." });
  }

  const payload = parsed.data;

  const ruleBased =
    payload.subcategory === "Verbal Logical Reasoning"
      ? ruleBasedValidateVlr({
          context_text: payload.context_text,
          statement_to_judge: payload.statement_to_judge,
          correctAnswer: payload.correctAnswer,
          explanation: payload.explanation
        })
      : null;

  const validation = ruleBased
    ? ruleBased
    : await validateWithAI({
        category: payload.category,
        subcategory: payload.subcategory,
        difficulty: payload.difficulty,
        usageType: payload.usageType,
        question: payload.question,
        context_text: payload.context_text,
        statement_to_judge: payload.statement_to_judge,
        options: payload.options,
        correctAnswer: payload.correctAnswer,
        explanation: payload.explanation
      });

  if (!validation) {
    return res.status(502).json({ message: "AI validator failed." });
  }

  return res.json({
    isValid: validation.is_valid && validation.verdict === "valid",
    validationError: validation.is_valid ? null : (validation.issues[0]?.message || "AI validator flagged issues."),
    validationDetail: validation
  });
});

router.post("/autofix", async (req, res) => {
  const parsed = autoFixSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }

  if (!env.OPENAI_API_KEY || !env.OPENAI_VALIDATOR_MODEL) {
    return res.status(500).json({ message: "OPENAI_API_KEY/OPENAI_VALIDATOR_MODEL not configured." });
  }

  const payload = parsed.data;
  const fixed = await fixWithAI({
    category: payload.category,
    subcategory: payload.subcategory,
    difficulty: payload.difficulty,
    usageType: payload.usageType,
    question: payload.question,
    context_text: payload.context_text,
    statement_to_judge: payload.statement_to_judge,
    options: payload.options,
    correctAnswer: payload.correctAnswer,
    explanation: payload.explanation,
    validationDetail: payload.validationDetail ?? null
  });

  if (!fixed) {
    return res.status(502).json({ message: "AI autofix failed." });
  }

  let question = fixed.question;
  let context_text = fixed.context_text;
  let statement_to_judge = fixed.statement_to_judge;
  if (payload.subcategory === "Verbal Logical Reasoning") {
    const ctx = (context_text || "").trim();
    const stmt = (statement_to_judge || "").trim();
    question = `${ctx}\n\n${stmt}`.trim();
    context_text = ctx;
    statement_to_judge = stmt;
  }

  const validation = await validateWithAI({
    category: payload.category,
    subcategory: payload.subcategory,
    difficulty: payload.difficulty,
    usageType: payload.usageType,
    question: question ?? "",
    context_text,
    statement_to_judge,
    options: fixed.options,
    correctAnswer: fixed.correctAnswer,
    explanation: fixed.explanation
  });

  const aiValid =
    validation ? validation.is_valid && validation.verdict === "valid" : false;

  let savedId: string | null = null;
  if (payload.save && aiValid) {
    savedId = randomUUID();
    await db.insert(questionBank).values({
      id: savedId,
      category: payload.category,
      subcategory: payload.subcategory,
      difficulty: payload.difficulty,
      usageType: payload.usageType,
      question,
      options: JSON.stringify(fixed.options),
      correctAnswer: fixed.correctAnswer,
      explanation: fixed.explanation,
      source: "ai",
      sourceDetail: "",
      status: "draft"
    });
  }

  return res.json({
    question,
    context_text,
    statement_to_judge,
    options: fixed.options,
    correctAnswer: fixed.correctAnswer,
    explanation: fixed.explanation,
    id: savedId,
    isValid: aiValid,
    validationError: aiValid ? null : (validation?.issues?.[0]?.message || "AI validator flagged issues."),
    validationDetail: validation ?? null
  });
});

router.post("/generate", async (req, res) => {
  const parsed = generateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }

  if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL) {
    return res.status(500).json({ message: "OPENAI_API_KEY/OPENAI_MODEL not configured." });
  }

  const { category, subcategory, difficulty, usageType, save, validate, sharedContext, contextText, usedStatements } = parsed.data;
  const blueprint = blueprints[subcategory];
  if (!blueprint) {
    return res.status(400).json({ message: "Unsupported subcategory." });
  }

  const examples = subcategory === "Verbal Logical Reasoning"
    ? pickVlrExamples(3).map((ex, idx) => ({
        id: `vlr-${idx}`,
        question: ex.question,
        options: JSON.stringify(ex.options),
        correctAnswer: ex.correctAnswer,
        explanation: ex.explanation
      }))
    : await db
        .select({
          id: questionBank.id,
          question: questionBank.question,
          options: questionBank.options,
          correctAnswer: questionBank.correctAnswer,
          explanation: questionBank.explanation
        })
        .from(questionBank)
        .where(
          and(
            eq(questionBank.category, category),
            eq(questionBank.subcategory, subcategory),
            eq(questionBank.status, "approved")
          )
        )
        .orderBy(sql`random()`)
        .limit(3);

  if (examples.length === 0) {
    return res.status(400).json({ message: "No approved examples found for this subcategory." });
  }

  const exampleText = examples
    .map((ex, idx) => {
      const opts = JSON.parse(ex.options) as string[];
      return [
        `Contoh ${idx + 1}:`,
        ex.question,
        `Opsi: ${opts.map((o, i) => String.fromCharCode(65 + i) + ". " + o).join(" | ")}`,
        `Jawaban: ${ex.correctAnswer ?? "-"}`,
        `Pembahasan: ${ex.explanation ?? "-"}`
      ].join("\n");
    })
    .join("\n\n");

  const system = [
    `Anda adalah pembuat soal ${category} submateri ${subcategory}.`,
    "Ikuti blueprint dengan ketat.",
    "Gunakan bahasa Indonesia formal dan ringkas.",
    "Output harus JSON sesuai schema."
  ].join("\n");

  const userLines = [
    blueprint,
    `Kategori: ${category}`,
    `Submateri: ${subcategory}`,
    `Kesulitan: ${difficulty}`,
    "",
    "Berikut contoh gaya soal (jangan menyalin):",
    exampleText,
    "",
    "Tugas: buat 1 soal baru.",
    "JANGAN menuliskan opsi jawaban (A/B/C/D/E) di dalam pertanyaan."
  ];
  if (subcategory === "Adaptif") {
    userLines.push(
      "Perhatian: Hindari jawaban benar yang berfokus pada 'mengajari rekan kerja' atau 'mengadakan pelatihan' (itu masuk Kompeten).",
      "Untuk Adaptif, fokuskan jawaban benar pada inisiatif pribadi, penyesuaian proses, dan perbaikan sistem/teknologi."
    );
  }
  if (subcategory === "Verbal Logical Reasoning") {
    const targetPattern = pickVlrPattern();
    userLines.push(
      "",
      `Pola soal wajib: ${targetPattern}.`,
      "Jika pola wajib bukan kuantitatif, DILARANG menggunakan data hitung/himpunan sebagai inti soal.",
      "Pastikan pola soal berbeda dari dua contoh teratas."
    );
    if (sharedContext && (contextText || "").trim()) {
      const fixedContext = (contextText || "").trim();
      userLines.push(
        "",
        "MODE KHUSUS: SHARED CONTEXT",
        "Gunakan context_text berikut apa adanya (jangan ubah fakta, angka, maupun entitas):",
        fixedContext,
        "",
        "Buat statement_to_judge baru yang berbeda dari statement sebelumnya.",
        "statement_to_judge wajib bisa dinilai dengan opsi A/B/C (bukan opini)."
      );
      if (Array.isArray(usedStatements) && usedStatements.length > 0) {
        userLines.push(
          "Dilarang mengulang statement berikut:",
          ...usedStatements.map((s, i) => `${i + 1}. ${s}`)
        );
      }
    }
  }
  const user = userLines.join("\n");

  const isNumberSequence = subcategory === "Number Sequence";
  const isWordClassification = subcategory === "Word Classification";
  const isVlr = subcategory === "Verbal Logical Reasoning";
  const isAkhlaq = category === "AKHLAK";
  const baseProps = {
    options: {
      type: "array",
      items: { type: "string" },
      minItems: isAkhlaq ? 4 : isNumberSequence || isWordClassification ? 5 : isVlr ? 3 : 3,
      maxItems: isAkhlaq ? 4 : isNumberSequence || isWordClassification ? 5 : isVlr ? 3 : 3
    },
    correctAnswer: {
      type: "string",
      enum: isAkhlaq
        ? ["A", "B", "C", "D"]
        : isNumberSequence || isWordClassification
          ? ["A", "B", "C", "D", "E"]
          : ["A", "B", "C"]
    },
    explanation: { type: "string" }
  } as const;

  const schema = isVlr
    ? ({
        name: "tkd_vlr_question",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            context_text: { type: "string" },
            statement_to_judge: { type: "string" },
            ...baseProps
          },
          required: ["context_text", "statement_to_judge", "options", "correctAnswer", "explanation"]
        },
        strict: true
      } as const)
    : ({
        name: "tkd_question",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            ...baseProps
          },
          required: ["question", "options", "correctAnswer", "explanation"]
        },
        strict: true
      } as const);

  let parsedOut: {
    question?: string;
    context_text?: string;
    statement_to_judge?: string;
    options: string[];
    correctAnswer: "A" | "B" | "C" | "D" | "E";
    explanation: string;
  } | null = null;
  let lastInvalidOut: typeof parsedOut = null;

  let lastValidationError: string | null = null;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        response_format: { type: "json_schema", json_schema: schema }
      })
    });

    if (!aiRes.ok) {
      const err = await aiRes.json().catch(() => ({}));
      return res.status(502).json({ message: "AI request failed", details: err });
    }

    const data = (await aiRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(502).json({ message: "AI response missing content." });
    }

    try {
      parsedOut = JSON.parse(content);
    } catch {
      lastValidationError = "AI response is not valid JSON.";
      continue;
    }

    // --- validation below can set lastValidationError and continue ---
    const validationError = (() => {
      if (Array.isArray(parsedOut?.options)) {
        parsedOut!.options = parsedOut!.options.map((opt) =>
          opt.replace(/^[A-E]\.?\s*/i, "").trim()
        );
      }

      if (isVlr) {
        const ctxRaw = parsedOut?.context_text ?? "";
        const stmtRaw = parsedOut?.statement_to_judge ?? "";
        const ctx = ctxRaw.trim();
        let stmt = stmtRaw.trim();
        stmt = stmt.replace(
          /^(Simpulan bahwa\s+|Oleh karena itu,\s+|Dengan demikian,\s+|Maka,\s+|Sehingga,\s+)/i,
          ""
        ).trim();

        parsedOut!.context_text = ctx;
        parsedOut!.statement_to_judge = stmt;
        parsedOut!.question = `${ctx}\n\n${stmt}`.trim();

        if (!ctx || !stmt) {
          return "AI output invalid: context_text/statement_to_judge is empty. Regenerate.";
        }

        const forbiddenContextPhrases =
          /(oleh karena itu|dengan demikian|dapat disimpulkan|kesimpulannya|sehingga dapat)/i;
        if (forbiddenContextPhrases.test(ctx)) {
          return "AI output invalid: context contains conclusion markers. Regenerate.";
        }

        const hasAllStatement = /\bsemua\b/i.test(stmt);
        const hasRemainderGroup = /(sisa|sisanya|lainnya|kelompok lain|kategori lain|lain-lain)/i.test(ctx);
        const remainderHasStatus = /(sisanya|sisa|lainnya|kelompok lain|kategori lain)[^.]*\b(juga\s+)?(mendapatkan|tidak mendapatkan|berhak|tidak berhak|wajib|tidak wajib)\b/i.test(ctx);
        if (hasAllStatement && hasRemainderGroup && !remainderHasStatus) {
          return "AI output invalid: context has remainder group without attribute status while statement uses 'semua'. Regenerate.";
        }

        const ctxNorm = ctx.toLowerCase().replace(/\s+/g, " ").trim();
        const stmtNorm = stmt.toLowerCase().replace(/\s+/g, " ").trim();
        if (stmtNorm && ctxNorm.includes(stmtNorm)) {
          return "AI output invalid: statement repeated inside context. Regenerate.";
        }

        const explanation = parsedOut?.explanation ?? "";
        const exp = explanation.toLowerCase();
        const correct = parsedOut?.correctAnswer;
        if (exp.includes("simpulan adalah benar") && correct !== "A") {
          return "AI output invalid: explanation says benar but correctAnswer is not A.";
        }
        if (exp.includes("simpulan adalah salah") && correct !== "B") {
          return "AI output invalid: explanation says salah but correctAnswer is not B.";
        }
        if (exp.includes("tidak dapat disimpulkan") && correct !== "C") {
          return "AI output invalid: explanation says tidak dapat disimpulkan but correctAnswer is not C.";
        }

        return null;
      }

      const rawQuestion = parsedOut?.question ?? "";
      const optionStart = (() => {
        const idxA = rawQuestion.search(/\bA\.\s/);
        if (idxA === -1) return -1;
        const tail = rawQuestion.slice(idxA);
        if (!/\bB\.\s/.test(tail)) return -1;
        return idxA;
      })();
      const truncated =
        optionStart >= 0 ? rawQuestion.slice(0, optionStart).trim() : rawQuestion.trim();
      if (parsedOut) {
        parsedOut.question = truncated
          .replace(/\bPilihan Jawaban\s*:?\s*$/i, "")
          .replace(/\s*[:\-–—]\s*$/i, "")
          .trim();
      }

      return null;
    })();

    if (!validationError) break;
    lastValidationError = validationError;
    lastInvalidOut = parsedOut;
    parsedOut = null;
  }

  if (!parsedOut) {
    const fallback = lastInvalidOut || {
      question: "",
      options: [],
      correctAnswer: "A",
      explanation: ""
    };
    return res.json({ ...fallback, id: null, isValid: false, validationError: lastValidationError || "AI output invalid." });
  }


  const ruleBased =
    validate && subcategory === "Verbal Logical Reasoning"
      ? ruleBasedValidateVlr({
          context_text: parsedOut.context_text,
          statement_to_judge: parsedOut.statement_to_judge,
          correctAnswer: parsedOut.correctAnswer,
          explanation: parsedOut.explanation
        })
      : null;

  const validation = ruleBased
    ? ruleBased
    : validate
      ? await validateWithAI({
          category,
          subcategory,
          difficulty,
          usageType,
          question: parsedOut.question ?? "",
          context_text: parsedOut.context_text,
          statement_to_judge: parsedOut.statement_to_judge,
          options: parsedOut.options,
          correctAnswer: parsedOut.correctAnswer,
          explanation: parsedOut.explanation
        })
      : null;

  const aiValid =
    validation ? validation.is_valid && validation.verdict === "valid" : true;

  const generatedSourceDetail =
    subcategory === "Verbal Logical Reasoning" &&
    sharedContext &&
    (parsedOut.context_text || "").trim()
      ? buildSharedContextDetail((parsedOut.context_text || "").trim())
      : "";

  let savedId: string | null = null;
  if (save && aiValid) {
    savedId = randomUUID();
    await db.insert(questionBank).values({
      id: savedId,
      category,
      subcategory,
      difficulty,
      usageType,
      question: parsedOut.question,
      options: JSON.stringify(parsedOut.options),
      correctAnswer: parsedOut.correctAnswer,
      explanation: parsedOut.explanation,
      source: "ai",
      sourceDetail: generatedSourceDetail,
      status: "draft"
    });
  }

  return res.json({
    ...parsedOut,
    id: savedId,
    sourceDetail: generatedSourceDetail,
    isValid: aiValid,
    validationError: aiValid ? null : (validation?.issues?.[0]?.message || "AI validator flagged issues."),
    validationDetail: validation ?? null
  });
});

router.get("/", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  const category = (req.query.category || "").toString().trim();
  const subcategory = (req.query.subcategory || "").toString().trim();
  const difficulty = (req.query.difficulty || "").toString().trim();
  const status = (req.query.status || "").toString().trim();
  const usage = (req.query.usage || "").toString().trim();
  const source = (req.query.source || "").toString().trim();
  const sourceDetail = (req.query.sourceDetail || "").toString().trim();
  const sourceDetailPrefix = (req.query.sourceDetailPrefix || "").toString().trim();
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(5, Number(req.query.limit || 10)));
  const offset = (page - 1) * limit;

  const whereParts: any[] = [];
  if (q) {
    const pattern = `%${q}%`;
    whereParts.push(
      or(
        like(questionBank.id, pattern),
        like(questionBank.question, pattern)
      )
    );
  }
  if (category) whereParts.push(eq(questionBank.category, category));
  if (subcategory) whereParts.push(eq(questionBank.subcategory, subcategory));
  if (difficulty) whereParts.push(eq(questionBank.difficulty, difficulty));
  if (status) whereParts.push(eq(questionBank.status, status));
  if (source) whereParts.push(eq(questionBank.source, source));
  if (sourceDetail) whereParts.push(eq(questionBank.sourceDetail, sourceDetail));
  if (sourceDetailPrefix) whereParts.push(like(questionBank.sourceDetail, `${sourceDetailPrefix}%`));

  const whereClause = whereParts.length ? and(...whereParts) : undefined;

  const rows = await db
    .select({
      id: questionBank.id,
      category: questionBank.category,
      subcategory: questionBank.subcategory,
      difficulty: questionBank.difficulty,
      status: questionBank.status,
      question: questionBank.question,
      usageType: questionBank.usageType,
      source: questionBank.source,
      sourceDetail: questionBank.sourceDetail,
      createdAt: questionBank.createdAt,
      usedCount: sql<number>`count(${questionUsage.id})`,
      setCount: sql<number>`count(${latsolSetQuestion.id})`,
    })
    .from(questionBank)
    .leftJoin(questionUsage, eq(questionUsage.questionId, questionBank.id))
    .leftJoin(latsolSetQuestion, eq(latsolSetQuestion.questionId, questionBank.id))
    .where(whereClause)
    .groupBy(questionBank.id)
    .having(
      usage === "used"
        ? sql`count(${questionUsage.id}) > 0`
        : usage === "unused"
        ? sql`count(${questionUsage.id}) = 0`
        : undefined
    )
    .orderBy(sql`created_at desc`)
    .limit(limit)
    .offset(offset);

  const totalRowsQuery = await db
    .select({ total: sql<number>`count(${questionBank.id})` })
    .from(questionBank)
    .leftJoin(questionUsage, eq(questionUsage.questionId, questionBank.id))
    .where(whereClause)
    .groupBy(questionBank.id)
    .having(
      usage === "used"
        ? sql`count(${questionUsage.id}) > 0`
        : usage === "unused"
        ? sql`count(${questionUsage.id}) = 0`
        : undefined
    );

  const totalRows = totalRowsQuery.length;

  const statsTotal = await db.select({ total: sql<number>`count(*)` }).from(questionBank);
  const statsUsed = await db.select({ total: sql<number>`count(*)` }).from(questionUsage);
  const statsDraft = await db.select({ total: sql<number>`count(*)` }).from(questionBank).where(eq(questionBank.status, "draft"));
  const statsApproved = await db.select({ total: sql<number>`count(*)` }).from(questionBank).where(eq(questionBank.status, "approved"));
  const statsArchived = await db.select({ total: sql<number>`count(*)` }).from(questionBank).where(eq(questionBank.status, "archived"));

  return res.json({
    items: rows,
    total: totalRows || 0,
    page,
    limit,
    stats: {
      total: statsTotal[0]?.total || 0,
      draft: statsDraft[0]?.total || 0,
      approved: statsApproved[0]?.total || 0,
      archived: statsArchived[0]?.total || 0,
      used: statsUsed[0]?.total || 0,
    },
  });
});

router.get("/:id", async (req, res) => {
  const id = req.params.id;
  const rows = await db
    .select({
      id: questionBank.id,
      category: questionBank.category,
      subcategory: questionBank.subcategory,
      difficulty: questionBank.difficulty,
      usageType: questionBank.usageType,
      question: questionBank.question,
      options: questionBank.options,
      correctAnswer: questionBank.correctAnswer,
      explanation: questionBank.explanation,
      status: questionBank.status,
      source: questionBank.source,
      sourceDetail: questionBank.sourceDetail,
      createdAt: questionBank.createdAt,
      updatedAt: questionBank.updatedAt,
    })
    .from(questionBank)
    .where(eq(questionBank.id, id))
    .limit(1);

  if (!rows.length) {
    return res.status(404).json({ message: "Question not found" });
  }

  return res.json({ item: rows[0] });
});

router.patch("/:id", async (req, res) => {
  const id = req.params.id;
  const schema = z.object({
    category: z.string().min(1).optional(),
    subcategory: z.string().min(1).optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    usageType: z.string().min(1).optional(),
    question: z.string().min(1).optional(),
    options: z.array(z.string()).min(2).optional(),
    correctAnswer: z.string().min(1).optional(),
    explanation: z.string().optional(),
    status: z.enum(["draft", "approved", "archived"]).optional(),
    source: z.string().optional(),
    sourceDetail: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }
  const data = parsed.data;

  if (data.options) {
    const len = data.options.length;
    const upper = (data.correctAnswer || "").trim().toUpperCase();
    if (upper) {
      const idx = upper.charCodeAt(0) - 65;
      if (Number.isNaN(idx) || idx < 0 || idx >= len) {
        return res.status(400).json({ message: "correctAnswer tidak valid untuk jumlah opsi." });
      }
    }
  }

  const updatePayload: any = {
    ...data,
  };
  if (Array.isArray(data.options)) {
    updatePayload.options = JSON.stringify(data.options);
  }

  await db.update(questionBank).set(updatePayload).where(eq(questionBank.id, id));
  const rows = await db
    .select({
      id: questionBank.id,
      category: questionBank.category,
      subcategory: questionBank.subcategory,
      difficulty: questionBank.difficulty,
      usageType: questionBank.usageType,
      question: questionBank.question,
      options: questionBank.options,
      correctAnswer: questionBank.correctAnswer,
      explanation: questionBank.explanation,
      status: questionBank.status,
      source: questionBank.source,
      sourceDetail: questionBank.sourceDetail,
      createdAt: questionBank.createdAt,
      updatedAt: questionBank.updatedAt,
    })
    .from(questionBank)
    .where(eq(questionBank.id, id))
    .limit(1);

  return res.json({ item: rows[0] });
});

router.delete("/:id", async (req, res) => {
  const id = req.params.id;
  await db.delete(questionUsage).where(eq(questionUsage.questionId, id));
  const result = await db.delete(questionBank).where(eq(questionBank.id, id));
  return res.json({ ok: true });
});

export default router;
