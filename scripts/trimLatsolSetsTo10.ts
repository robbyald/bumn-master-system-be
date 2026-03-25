import { db } from "../src/db/index.js";
import { latsolSet, latsolSetQuestion } from "../src/db/schema.js";
import { eq, and, gt } from "drizzle-orm";

const TARGET = 10;

const main = async () => {
  const sets = await db.select().from(latsolSet);
  for (const set of sets) {
    // delete extra questions beyond TARGET
    await db
      .delete(latsolSetQuestion)
      .where(and(eq(latsolSetQuestion.setId, set.id), gt(latsolSetQuestion.order, TARGET)));

    // update totalQuestions
    if (set.totalQuestions !== TARGET) {
      await db
        .update(latsolSet)
        .set({ totalQuestions: TARGET })
        .where(eq(latsolSet.id, set.id));
    }
  }

  console.log(`[trim-latsol] trimmed ${sets.length} set(s) to ${TARGET} questions`);
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
