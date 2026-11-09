import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/env.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ALGORITHM = "HS256";
const ISSUER = "acme-hr";

/**
 * A login token is a signed JSON object: { sub: "<employee id>", iat, exp, iss }.
 * Anyone can read it (it's only base64), but nobody can change it without
 * the secret, because the signature would no longer match.
 */
export async function signAccessToken(employeeId: number): Promise<string> {
  return new SignJWT()
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(String(employeeId))
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_TTL_SECONDS}s`)
    .sign(secret);
}

/** Returns the employee id inside a valid token, or null if it's forged, expired or malformed. */
export async function verifyAccessToken(token: string): Promise<number | null> {
  try {
    // algorithms: refuse tokens claiming another algorithm (e.g. "none").
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALGORITHM], issuer: ISSUER });
    const id = Number(payload.sub);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
