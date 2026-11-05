import { PDFParse } from "pdf-parse";

export interface PageText {
  /** 1-based page number, as a person would read it in a PDF viewer. */
  page: number;
  text: string;
}

/**
 * Tidies text pulled out of a PDF. PDFs store text as positioned fragments,
 * so extraction often leaves runs of spaces, trailing spaces and big gaps
 * of blank lines. Single line breaks are kept: they mark headings and lists.
 */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n") // Windows/old-Mac line endings → \n
    .replace(/[ \t ]+/g, " ") // runs of spaces/tabs → one space
    .replace(/ *\n */g, "\n") // no spaces around line breaks
    .replace(/\n{3,}/g, "\n\n") // at most one blank line in a row
    .trim();
}

/**
 * Extracts the text of every page of a PDF.
 * Pages with no text (e.g. a full-page image) are dropped.
 * Throws if the whole PDF has no text, which usually means it is a scan
 * (pictures of pages) and would need OCR, which we don't do.
 */
export async function extractPages(pdf: Buffer): Promise<PageText[]> {
  // pdf.js may take ownership of the bytes it's given, so pass a copy.
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    const result = await parser.getText();
    const pages = result.pages
      .map((p) => ({ page: p.num, text: cleanText(p.text) }))
      .filter((p) => p.text.length > 0);

    if (pages.length === 0) {
      throw new Error("PDF contains no extractable text (is it a scanned document?)");
    }
    return pages;
  } finally {
    // Free pdf.js memory even if parsing failed.
    await parser.destroy();
  }
}
