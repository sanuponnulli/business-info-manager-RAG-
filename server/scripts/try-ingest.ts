/**
 * Manual check for Chunk 4: runs the full ingestion pipeline on a PDF
 * (needs Gemini + ChromaDB), waits for the job, then lists stored documents.
 * Run it twice on the same file: the chunk count must stay the same.
 *
 *   npx tsx --env-file=.env scripts/try-ingest.ts ./sample.pdf
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { enqueue, getJob, listDocuments } from "../src/services/ingestion.service.js";
import { slugify } from "../src/lib/slug.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx --env-file=.env scripts/try-ingest.ts <file.pdf>");
  process.exit(1);
}

const job = enqueue({
  pdf: await readFile(file),
  docId: slugify(basename(file)),
  title: basename(file, ".pdf"),
});
console.log(`Job ${job.id} queued for docId "${job.docId}"`);

// Poll the job like a client would, printing each status change.
let last = "";
for (;;) {
  const { status, chunks, error } = getJob(job.id)!;
  if (status !== last) console.log(`  status: ${status}${chunks ? ` (${chunks} chunks)` : ""}${error ? ` - ${error}` : ""}`);
  last = status;
  if (status === "done" || status === "failed") break;
  await new Promise((r) => setTimeout(r, 300));
}

console.log("\nDocuments in ChromaDB:");
console.table(await listDocuments());
