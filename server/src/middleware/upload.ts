import multer from "multer";
import { HttpError } from "../lib/httpError.js";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Handles `multipart/form-data` uploads (the format browsers use for file
 * inputs). The file is kept in memory as a Buffer (req.file.buffer), since
 * we pass it straight to the ingestion queue and never need it on disk.
 */
export const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, accept) => {
    // First check: what the client claims the file is. The controller also
    // checks the file's actual first bytes, since this header can lie.
    if (file.mimetype !== "application/pdf") {
      accept(new HttpError(400, "not_a_pdf", "Only PDF files are accepted"));
      return;
    }
    accept(null, true);
  },
}).single("file"); // the form field must be named "file"
