/**
 * Turns a file name into a stable document id:
 *   "Employee Handbook 2026.pdf" → "employee-handbook-2026"
 * Uploading the same file name again gives the same id, which is what lets
 * a re-upload replace the old version instead of adding a duplicate.
 */
export function slugify(name: string): string {
  return name
    .replace(/\.[^.]+$/, "") // drop the extension
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // é → e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // anything else → "-"
    .replace(/^-+|-+$/g, "") // no leading/trailing "-"
    .slice(0, 80);
}
