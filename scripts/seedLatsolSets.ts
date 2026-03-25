import { db } from "../src/db/index.js";
import { latsolSet, latsolSetQuestion, questionBank } from "../src/db/schema.js";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";

type SubConfig = {
  categoryId: string;
  category: "TKD" | "AKHLAK" | "TBI" | "OTHERS";
  subcategory: string;
  setCount: number;
  questionsPerSet: number;
};

const configs: SubConfig[] = [
  { categoryId: "tkd-1", category: "TKD", subcategory: "Verbal Logical Reasoning", setCount: 50, questionsPerSet: 10 },
  { categoryId: "tkd-2", category: "TKD", subcategory: "Number Sequence", setCount: 50, questionsPerSet: 10 },
  { categoryId: "tkd-3", category: "TKD", subcategory: "Word Classification", setCount: 50, questionsPerSet: 10 },
  { categoryId: "tkd-4", category: "TKD", subcategory: "Diagram Reasoning", setCount: 50, questionsPerSet: 10 },
  { categoryId: "akh-1", category: "AKHLAK", subcategory: "Amanah", setCount: 50, questionsPerSet: 10 },
  { categoryId: "akh-2", category: "AKHLAK", subcategory: "Kompeten", setCount: 50, questionsPerSet: 10 },
  { categoryId: "akh-3", category: "AKHLAK", subcategory: "Harmonis", setCount: 50, questionsPerSet: 10 },
  { categoryId: "akh-4", category: "AKHLAK", subcategory: "Loyal", setCount: 50, questionsPerSet: 10 },
  { categoryId: "akh-5", category: "AKHLAK", subcategory: "Adaptif", setCount: 50, questionsPerSet: 10 },
  { categoryId: "akh-6", category: "AKHLAK", subcategory: "Kolaboratif", setCount: 50, questionsPerSet: 10 },
  { categoryId: "tbi-1", category: "TBI", subcategory: "Structure", setCount: 50, questionsPerSet: 10 },
  { categoryId: "tbi-2", category: "TBI", subcategory: "Written Expression", setCount: 50, questionsPerSet: 10 },
  { categoryId: "tbi-3", category: "TBI", subcategory: "Reading Comprehension", setCount: 50, questionsPerSet: 10 },
  { categoryId: "oth-1", category: "OTHERS", subcategory: "Wawasan Kebangsaan", setCount: 25, questionsPerSet: 10 },
  { categoryId: "oth-2", category: "OTHERS", subcategory: "Learning Agility", setCount: 25, questionsPerSet: 10 },
];

const pick = <T,>(arr: T[], n: number): T[] => {
  const copy = [...arr];
  const result: T[] = [];
  while (copy.length && result.length < n) {
    const idx = Math.floor(Math.random() * copy.length);
    result.push(copy.splice(idx, 1)[0] as T);
  }
  return result;
};

const main = async () => {
  console.log("[seed-latsol] clearing existing sets...");
  await db.delete(latsolSetQuestion);
  await db.delete(latsolSet);

  const used = new Set<string>();

  for (const cfg of configs) {
    const allQuestions = await db
      .select({
        id: questionBank.id,
        difficulty: questionBank.difficulty,
      })
      .from(questionBank)
      .where(
        and(eq(questionBank.category, cfg.category), eq(questionBank.subcategory, cfg.subcategory))
      );

    const pool = allQuestions.filter((q) => !used.has(q.id));
    const easy = pool.filter((q) => q.difficulty === "easy");
    const medium = pool.filter((q) => q.difficulty === "medium");
    const hard = pool.filter((q) => q.difficulty === "hard");

    const perSet = cfg.questionsPerSet;
    const targetEasy = Math.round(perSet * 0.35);
    const targetMedium = Math.round(perSet * 0.4);
    const targetHard = perSet - targetEasy - targetMedium;

    let created = 0;
    for (let i = 0; i < cfg.setCount; i += 1) {
      const chosen: { id: string }[] = [];
      chosen.push(...pick(easy.filter((q) => !used.has(q.id)), targetEasy));
      chosen.push(...pick(medium.filter((q) => !used.has(q.id)), targetMedium));
      chosen.push(...pick(hard.filter((q) => !used.has(q.id)), targetHard));

      if (chosen.length < perSet) {
        // fill from any remaining pool
        const rest = pool.filter((q) => !used.has(q.id) && !chosen.find((c) => c.id === q.id));
        chosen.push(...pick(rest, perSet - chosen.length));
      }

      if (chosen.length < perSet) {
        console.log(`[seed-latsol] stop ${cfg.subcategory}, not enough questions (${chosen.length}/${perSet})`);
        break;
      }

      const setId = randomUUID();
      await db.insert(latsolSet).values({
        id: setId,
        categoryId: cfg.categoryId,
        category: cfg.category,
        subcategory: cfg.subcategory,
        title: `Latihan Soal ${i + 1}`,
        totalQuestions: perSet,
        durationMinutes: 60,
        isPremium: false,
      });

      let order = 1;
      for (const q of chosen) {
        used.add(q.id);
        await db.insert(latsolSetQuestion).values({
          id: randomUUID(),
          setId,
          questionId: q.id,
          order: order++,
        });
      }
      created += 1;
    }
    console.log(`[seed-latsol] ${cfg.subcategory}: created ${created} set(s)`);
  }

  console.log("[seed-latsol] done");
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
