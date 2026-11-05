/**
 * Manual check for Chunk 2: embeds one piece of text with Gemini and prints
 * the vector's size and first few numbers. Also compares how close a few
 * texts are to it, so you can see "similar meaning = similar vector".
 *
 *   npx tsx --env-file=.env scripts/try-embed.ts "annual leave policy"
 */
import { embedDocuments, embedQuery } from "../src/services/embedding.service.js";

const query = process.argv[2] ?? "annual leave policy";

const q = await embedQuery(query);
console.log(`Query: "${query}"`);
console.log("length:", q.length);
console.log("first 5 values:", q.slice(0, 5).map((n) => n.toFixed(4)));

const docs = [
  "Employees receive 25 days of paid holiday per year.",
  "Sick leave must be reported to your manager before 9am.",
  "The office kitchen is cleaned every Friday afternoon.",
];
const vectors = await embedDocuments(docs);

// Cosine similarity: 1 = same direction (same meaning), near 0 = unrelated.
const cosine = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

console.log("\nSimilarity to the query:");
docs.forEach((doc, i) => console.log(`  ${cosine(q, vectors[i]).toFixed(3)}  ${doc}`));
