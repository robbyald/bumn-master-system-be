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

const inputPath = resolve("data/goldset/tkd-verbal.json");
const outputPath = resolve("data/finetune/tkd-verbal-train.jsonl");

const raw = readFileSync(inputPath, "utf-8");
const items = JSON.parse(raw) as GoldQuestion[];

const system = [
  "Anda adalah pembuat soal TKD BUMN submateri Verbal Logical Reasoning.",
  "Output HARUS JSON dengan field: context_text, statement_to_judge, options, correctAnswer, explanation.",
  "context_text hanya berisi fakta/angka/aturan, tanpa kata kesimpulan (mis. 'Oleh karena itu', 'Dapat disimpulkan').",
  "statement_to_judge adalah 1 kalimat klaim langsung tanpa awalan seperti 'Simpulan bahwa'.",
  "Options selalu 3 pilihan: A, B, C (Benar/Salah/Tidak dapat disimpulkan)."
].join("\n");

const lines = items.map((q) => {
  const user = [
    `Kategori: ${q.category}`,
    `Submateri: ${q.subcategory}`,
    `Kesulitan: ${q.difficulty}`,
    "Buat 1 soal sesuai format."
  ].join("\n");

  const parts = q.question.split(/\n\n+/);
  const context_text = (parts[0] || q.question).trim();
  const statement_to_judge = (parts.slice(1).join("\n\n") || "").trim();

  const assistant = JSON.stringify({
    context_text,
    statement_to_judge,
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
