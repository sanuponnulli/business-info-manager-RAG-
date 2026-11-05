/**
 * Manual check for Chunk 3: reads a PDF, extracts its pages and splits them
 * into chunks. No Gemini or ChromaDB involved, so no .env is needed.
 *
 *   npx tsx scripts/try-chunk.ts ./sample.pdf
 */
import { readFile } from "node:fs/promises";
import { extractPages } from "../src/ingestion/pdf.js";
import { chunkPages, CHUNK_OVERLAP } from "../src/ingestion/chunker.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx scripts/try-chunk.ts <file.pdf>");
  process.exit(1);
}

const pages = await extractPages(await readFile(file));
const chunks = await chunkPages(pages);

console.log(`Pages with text: ${pages.length}`);
console.log(`Chunks:          ${chunks.length}`);
const lengths = chunks.map((c) => c.text.length);
console.log(`Chunk length:    min ${Math.min(...lengths)}, max ${Math.max(...lengths)}`);

// Show two neighbouring chunks from the same page so the overlap is visible.
const i = chunks.findIndex((c, idx) => chunks[idx + 1]?.page === c.page);
if (i === -1) {
  console.log("\n(No page produced more than one chunk, so there is no overlap to show.)");
  console.log(`\n--- chunk 0 (page ${chunks[0].page}) ---\n${chunks[0].text}`);
} else {
  const [a, b] = [chunks[i], chunks[i + 1]];
  console.log(`\n--- chunk ${a.chunkIndex} (page ${a.page}) ---\n${a.text}`);
  console.log(`\n--- chunk ${b.chunkIndex} (page ${b.page}) ---\n${b.text}`);
  console.log(`\n--- end of chunk ${a.chunkIndex} (last ${CHUNK_OVERLAP} chars), should reappear at the start of chunk ${b.chunkIndex} ---`);
  console.log(a.text.slice(-CHUNK_OVERLAP));
}
