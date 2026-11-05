import { Router } from "express";
import { adminAuth } from "../middleware/adminAuth.js";
import { uploadPdf } from "../middleware/upload.js";
import * as admin from "../controllers/admin.controller.js";

/**
 * Routes only map URLs to controllers. Mounted at /api/v1/admin in app.ts.
 * adminAuth runs first for every route here, so no controller can forget it.
 */
export const adminRouter = Router();

adminRouter.use(adminAuth);

adminRouter.post("/documents", uploadPdf, admin.uploadDocument);
adminRouter.get("/documents", admin.listDocuments);
adminRouter.get("/documents/jobs/:jobId", admin.getJobStatus);
adminRouter.delete("/documents/:docId", admin.deleteDocument);
