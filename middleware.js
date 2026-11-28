// Afscherming van /hq voor de lokale dev-server (en Vercel). Productie draait op Cloudflare:
// daar doet worker/index.js precies dezelfde controle (api/_lib/guard.js).
import { next } from "@vercel/functions";
import { hqGuard } from "./api/_lib/guard.js";

export const config = { matcher: ["/hq", "/hq/:path*"] };

export default async function middleware(request) {
  const denied = await hqGuard(request);
  if (denied) return denied;
  return next({ headers: { "x-robots-tag": "noindex, nofollow", "cache-control": "private, no-store" } });
}
