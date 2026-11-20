// CONTENT (planner): maakt voor een contentopdracht drie verkoophoeken op basis van echte
// projectinformatie, vrijgegeven beelden, de pakketprijs uit hq.packages en de actie uit
// CONFIG (met einddatum). Zet het stuk daarna op "kiezen" (handmatig) of kiest zelf een hoek
// en start de render (automatisering).
import { factsFor, planAngles } from "../content/planner.js";
import { SITE, prices, contentSettings, applyAngle, pieceRow, assetInfo, monthSpend } from "../content/studio.js";
import { one, q } from "../db.js";

export const KIND = "content_plan";

export async function run({ task, ctx }) {
  const pieceId = task.input?.piece_id;
  const piece = await one("select * from hq.content_pieces where id=$1", [pieceId]);
  if (!piece) throw Object.assign(new Error("Contentstuk niet gevonden."), { retryable: false });
  if (piece.status === "gearchiveerd") return { status: "afgerond", result: { overgeslagen: "gearchiveerd" } };
  const s = await contentSettings();
  if (piece.origin === "automatisering" && s.paused) throw Object.assign(new Error("Automatisering staat op pauze."), { retryable: false });
  if ((await monthSpend()) >= s.monthly_budget_usd) throw Object.assign(new Error(`Kostenplafond van deze maand bereikt ($${s.monthly_budget_usd}).`), { retryable: false });
  const project = await one("select * from hq.projects where id=$1", [piece.project_id]);
  await ctx.step("Projectinformatie en vrijgegeven beelden verzamelen");
  // Geen expliciete keuze (oplevering/automatisering): alle beelden die nu zijn vrijgegeven.
  const assets = (await q("select * from hq.project_assets where project_id=$1 and (cardinality($2::uuid[]) = 0 or id = any($2::uuid[])) and social_ok and (valid_until is null or valid_until > now()) order by created_at", [piece.project_id, piece.asset_ids])).rows
    .map(a => ({ ...a, hint: assetInfo(a.path).hint || "" }));
  const pr = await prices();
  const facts = factsFor({ project, assets, audienceKey: piece.audience, goal: piece.goal, prices: pr, site: SITE });
  await ctx.step("Drie verkoophoeken maken", { beelden: assets.length, prijs_vanaf: pr.from_eur, actie: Boolean(facts.promo) });
  const { angles, methode } = await planAngles(facts, { ctx });
  return {
    status: "afgerond",
    result: { methode, hoeken: angles.map(a => ({ key: a.key, naam: a.name, opening: a.opening })), feiten: { prijs_vanaf: pr.from_eur, prijs_site: pr.site_from_eur, actie_tot: facts.promo?.until || null, beelden: facts.assets.map(a => a.path) } },
    message: `Drie hoeken klaar (${methode}).`,
    afterTx: async (db) => {
      await db.query("update hq.content_pieces set angles=$2, status='kiezen', updated_at=now() where id=$1 and status in ('plannen','kiezen')", [pieceId, JSON.stringify(angles)]);
      if (piece.origin === "automatisering") {
        // Afwisselen tussen hoeken: de n-de aflevering van deze regel krijgt hoek n mod 3.
        const n = (await db.query("select count(*)::int n from hq.content_pieces where automation_id=$1 and id<>$2", [piece.automation_id, pieceId])).rows[0].n;
        const p = await pieceRow(db, pieceId);
        await applyAngle(db, p, n % angles.length, null);
      }
    },
  };
}

export async function onFailure(db, task, { retry }) {
  if (retry) return;
  await db.query("update hq.content_pieces set updated_at=now() where id=$1", [task.input?.piece_id]);
}
