/**
 * Manual check for Chunk 6: asks the handbook a question and prints the
 * chunks that come back. Upload a document first (Chunk 4 or 5).
 *
 *   npx tsx --env-file=.env scripts/try-retrieve.ts "how many sick days do I get?"
 */
import { retrieveContext } from "../src/services/rag.service.js";

const question = process.argv[2];
if (!question) {
  console.error('Usage: npx tsx --env-file=.env scripts/try-retrieve.ts "<question>"');
  process.exit(1);
}

const { chunks, contextText } = await retrieveContext(question);

console.log(`Question: "${question}"\n`);
for (const c of chunks) {
  console.log(`score ${c.score.toFixed(3)} | ${c.title} p.${c.page} | ${c.text.slice(0, 90).replace(/\n/g, " ")}...`);
}
console.log("\n--- contextText (what the model will read) ---\n");
console.log(contextText);
