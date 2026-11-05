import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { PageText } from "./pdf.js";

export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 200;

export interface Chunk {
  text: string;
  /** Page the chunk came from, so answers can cite "p. 4". */
  page: number;
  /** Position of the chunk in the whole document: 0, 1, 2, ... */
  chunkIndex: number;
}

/**
 * Splits text into pieces of at most 1000 characters.
 *
 * "Recursive" means it tries the gentlest cut first: it splits on blank
 * lines (paragraphs); if a piece is still too long it splits that piece on
 * single line breaks, then on spaces, and only as a last resort mid-word.
 * So chunks usually end at a paragraph or sentence boundary.
 *
 * Each chunk repeats up to the last 200 characters of the one before it
 * (the overlap), so a sentence cut at a boundary still appears whole in
 * at least one chunk.
 */
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: CHUNK_SIZE,
  chunkOverlap: CHUNK_OVERLAP,
});

/**
 * Chunks each page separately so every chunk belongs to exactly one page.
 * Trade-off: a paragraph that runs across a page break is split there.
 * For handbooks, accurate page citations are worth that.
 */
export async function chunkPages(pages: PageText[]): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  for (const { page, text } of pages) {
    for (const piece of await splitter.splitText(text)) {
      chunks.push({ text: piece, page, chunkIndex: chunks.length });
    }
  }
  return chunks;
}
