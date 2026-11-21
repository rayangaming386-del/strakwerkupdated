#!/usr/bin/env node
// Eenmalig: Gmail koppelen voor HQ (alleen het recht "e-mail versturen", gmail.send).
// Draai dit op je eigen computer, ingelogd bij Cloudflare (npx wrangler login):
//   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node scripts/gmail-koppelen.mjs
// Je browser opent de Google-toestemming; daarna zet dit script het vernieuwingstoken met
// `wrangler secret put` direct in Cloudflare. Het token komt niet in een bestand of in beeld.
import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const id = (process.env.GMAIL_CLIENT_ID || "").trim(), secret = (process.env.GMAIL_CLIENT_SECRET || "").trim();
if (!id || !secret) { console.error("Zet GMAIL_CLIENT_ID en GMAIL_CLIENT_SECRET (OAuth-client van het type 'Desktop app')."); process.exit(1); }
const state = randomBytes(16).toString("hex");

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  if (u.pathname !== "/callback") { res.writeHead(404); return res.end(); }
  if (u.searchParams.get("state") !== state || !u.searchParams.get("code")) { res.writeHead(400); res.end("Ongeldig antwoord."); return; }
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: u.searchParams.get("code"), client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" }) });
  const j = await r.json();
  if (!j.refresh_token) { res.writeHead(500); res.end("Geen vernieuwingstoken ontvangen. Trek de toegang in (myaccount.google.com › Beveiliging › Apps) en probeer opnieuw."); console.error(j.error || "geen refresh_token"); process.exit(1); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end("<p>Gelukt. Je kunt dit venster sluiten.</p>");
  for (const [name, value] of [["GMAIL_CLIENT_ID", id], ["GMAIL_CLIENT_SECRET", secret], ["GMAIL_REFRESH_TOKEN", j.refresh_token]]) {
    await new Promise((ok, no) => {
      const p = spawn("npx", ["wrangler", "secret", "put", name], { stdio: ["pipe", "inherit", "inherit"], shell: process.platform === "win32" });
      p.stdin.end(value); p.on("exit", (c) => (c === 0 ? ok() : no(new Error(`wrangler secret put ${name} mislukt`))));
    });
  }
  console.log("Gmail gekoppeld: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET en GMAIL_REFRESH_TOKEN staan in Cloudflare.");
  server.close();
});

server.listen(0, "127.0.0.1", () => {
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: "code", scope: "https://www.googleapis.com/auth/gmail.send", access_type: "offline", prompt: "consent", state })}`;
  console.log(`Open deze link als je browser niet vanzelf opent:\n${url}\n`);
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try { spawn(opener, [url], { stdio: "ignore", shell: process.platform === "win32", detached: true }).unref(); } catch {}
});
