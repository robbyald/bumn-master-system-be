import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

type GoldQuestion = {
  id: string;
  category: string;
  subcategory: string;
  difficulty: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
};

const inputPath = resolve("data/goldset/akhlak-loyal.json");
const outputPath = resolve("data/finetune/akhlak-loyal-train.jsonl");

const raw = readFileSync(inputPath, "utf-8");
const items = JSON.parse(raw) as GoldQuestion[];

const system = [
  "Anda adalah pembuat soal AKHLAK submateri Loyal.",
  "Gunakan 4 opsi jawaban (A–D).",
  "Semua soal berbasis skenario dunia kerja profesional (SJT).",
  "Fokus pada indikator: menjaga nama baik, rela berkorban, dan patuh pada pimpinan sepanjang tidak melanggar hukum/etika.",
  "Output harus berbentuk JSON dengan field: question, options, correctAnswer, explanation."
].join("\n");

const lines = items.map((q) => {
  const user = [
    `Kategori: ${q.category}`,
    `Submateri: ${q.subcategory}`,
    `Kesulitan: ${q.difficulty}`,
    "Buat 1 soal sesuai format."
  ].join("\n");

  const assistant = JSON.stringify({
    question: q.question,
    options: q.options,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation
  });

  return JSON.stringify({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
      { role: "assistant", content: assistant }
    ]
  });
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, lines.join("\n") + "\n", "utf-8");

// eslint-disable-next-line no-console
console.log(`[finetune] Wrote ${lines.length} lines to ${outputPath}`);
