import type { RequestHandler } from "express";
import { currentUser } from "../middleware/userAuth.js";
import * as profile from "../services/profile.service.js";

/** GET /api/v1/me → { data: MyProfile } */
export const getMe: RequestHandler = async (req, res) => {
  res.json({ data: await profile.getMyProfile(currentUser(req).id) });
};
