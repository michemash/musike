import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export function requirePeachAdmin(request: { headers: { authorization?: string } }) {
  const authorization = request.headers.authorization ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const [payload, receivedSignature] = token.split(".");
  if (!config.musikeAdminSecret || !payload || !receivedSignature) {
    throw Object.assign(new Error("Open Peach Radio from the admin console."), { statusCode: 401 });
  }
  const expectedSignature = createHmac("sha256", config.musikeAdminSecret).update(payload).digest("base64url");
  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw Object.assign(new Error("Peach Radio admin access is invalid."), { statusCode: 401 });
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number; permission?: string };
    if (claims.permission !== "radio.manage" || !claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error("expired");
    }
  } catch {
    throw Object.assign(new Error("Peach Radio admin access has expired. Reopen it from the admin console."), { statusCode: 401 });
  }
}
