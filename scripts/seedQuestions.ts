import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../src/db/index.js";
import { questionBank } from "../src/db/schema.js";

type GoldQuestion = {
  id: string;
  category: string;
  subcategory: string;
  difficulty: string;
  usageType?: "practice" | "tryout";
  question: string;
  options: string[];
  correctAnswer: string | null;
  explanation: string | null;
  source?: string;
  sourceDetail?: string;
  status?: string;
};

const files = [
  resolve("data/goldset/tkd-number-sequence.json"),
  resolve("data/goldset/tkd-word-classification.json"),
  resolve("data/goldset/tkd-verbal.json"),
  resolve("data/goldset/akhlak-amanah.json"),
  resolve("data/goldset/akhlak-kompeten.json"),
  resolve("data/goldset/akhlak-harmonis.json"),
  resolve("data/goldset/akhlak-loyal.json"),
  resolve("data/goldset/akhlak-adaptif.json"),
  resolve("data/goldset/akhlak-kolaboratif.json")
].filter((p) => existsSync(p));

const items: GoldQuestion[] = [];
for (const filePath of files) {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as GoldQuestion[];
  if (Array.isArray(parsed)) items.push(...parsed);
}

if (items.length === 0) {
  throw new Error("No questions found in goldset files.");
}

  const rows = items.map((q) => ({
    id: q.id,
    category: q.category,
    subcategory: q.subcategory,
    difficulty: q.difficulty,
    usageType: q.usageType ?? "practice",
    question: q.question,
    options: JSON.stringify(q.options),
    correctAnswer: q.correctAnswer ?? null,
    explanation: q.explanation ?? null,
  source: q.source ?? "goldset",
  sourceDetail: q.sourceDetail ?? "",
  status: q.status ?? "draft"
}));

await db
  .insert(questionBank)
  .values(rows)
  .onConflictDoUpdate({
    target: questionBank.id,
    set: {
      category: questionBank.category,
      subcategory: questionBank.subcategory,
      difficulty: questionBank.difficulty,
      question: questionBank.question,
      options: questionBank.options,
      correctAnswer: questionBank.correctAnswer,
      explanation: questionBank.explanation,
      source: questionBank.source,
      sourceDetail: questionBank.sourceDetail,
      status: questionBank.status
    }
  });

// eslint-disable-next-line no-console
console.log(`[seed] Inserted/updated ${rows.length} questions into question_bank`);
