// Terugkerend werk voor "klanten winnen" (via /api/worker, ook door pg_cron elke 10 minuten):
// geplande berichten klaarzetten voor verzending, eigen fouten opsporen, ochtendoverleg,
// intake-herinneringen, wekelijkse Scout-ronde (alleen als Rayan die aanzet) en voorstellen.
import { q, one, tx } from "../db.js";
import { enqueue } from "../queue.js";
import { enqueueDueOutreach } from "./acquisition.js";
import { meetingTick, auditViolations, kantoorSettings } from "./planning.js";
import { weeklyProposals } from "./project.js";
import { flushNotifications } from "./notify.js";
import { amsParts, isoWeekKey } from "../content/studio.js";

async function once(key, hours) {
  const r = await one(`insert into hq.settings (key, value, updated_at) values ($1, '{}'::jsonb, now())
    on conflict (key) do update set updated_at=now() where hq.settings.updated_at < now() - make_interval(hours => $2) returning key`, [key, hours]);
  return Boolean(r);
}

export async function klantCron(now = new Date()) {
  const out = {};
  const k = await kantoorSettings();
  // Fouten opsporen draait altijd, ook in pauze (veiligheid).
  try { out.fouten = await auditViolations(); } catch (e) { out.fouten = { fout: e.message }; }
  await q("delete from hq.settings where key like 'rl:%' and updated_at < now() - interval '2 hours'");
  // Meldingen aan jou gaan altijd door (ook in pauze): het zijn berichten van klanten.
  try { out.meldingen = await flushNotifications(); } catch (e) { out.meldingen = { fout: e.message }; }
  if (k.paused) return { ...out, gepauzeerd: true };
  try { out.berichten = await enqueueDueOutreach(); } catch (e) { out.berichten = { fout: e.message }; }
  try { out.overleg = await meetingTick(now); } catch (e) { out.overleg = { fout: e.message }; }
  // Intake na 3 dagen niet compleet: herinnering klaarzetten (Rayan verstuurt; maximaal 2).
  try {
    const stuck = (await q(`select p.id, p.lead_id, p.name, p.is_test, l.contact_email, l.contact_phone, l.contact_name,
        (select count(*)::int from hq.outreach o where o.project_id=p.id and o.kind='intake_herinnering') as n
      from hq.projects p join hq.leads l on l.id=p.lead_id where p.status='intake' and p.intake_complete_at is null and p.intake_token_hash is not null and p.updated_at < now() - interval '3 days'`)).rows;
    let n = 0;
    for (const s of stuck.filter(x => x.n < 2)) {
      const r = await q(`insert into hq.outreach (lead_id, project_id, channel, kind, sequence, status, subject, body, to_address, idempotency_key, is_test)
        values ($1,$2,$3,'intake_herinnering',$4,'klaar_handmatig','Je materiaal voor de website',$5,$6,$7,$8) on conflict (idempotency_key) do nothing`,
        [s.lead_id, s.id, s.contact_email ? "email" : "whatsapp", s.n + 1, `Hoi${s.contact_name ? ` ${s.contact_name.split(" ")[0]}` : ""},\n\nZodra je teksten en beelden via je intake-link staan, ga ik voor je aan de slag. Lukt het niet, of wil je het liever samen doen in een kort gesprek? Laat het weten.\n\nGroet,\nRayan`,
         s.contact_email || s.contact_phone, `intake_herinnering:${s.id}:${s.n + 1}`, s.is_test]);
      n += r.rowCount;
    }
    out.intake_herinneringen = n;
  } catch (e) { out.intake_herinneringen = { fout: e.message }; }
  // Scout: wekelijks per actief segment en plaats, alleen als Rayan het heeft aangezet.
  try {
    const sc = (await one("select value from hq.settings where key='scout'"))?.value || {};
    if (sc.enabled && (sc.per_week || 0) > 0 && amsParts(now).wd === 2) {
      const week = isoWeekKey(now);
      const segs = (await q("select key, name, cities from hq.segments where active")).rows;
      const per = Math.max(1, Math.floor(sc.per_week / Math.max(1, segs.reduce((s, x) => s + x.cities.length, 0))));
      let n = 0;
      for (const sg of segs) for (const city of sg.cities) {
        await tx((db) => enqueue(db, { agent: "scout", kind: "ontdekken", title: `Ontdekken: ${sg.name} in ${city}`, input: { segment: sg.key, city, limit: per }, idempotencyKey: `ontdekken:${sg.key}:${city.toLowerCase()}:${week}` }));
        n++;
      }
      out.scout = n;
    }
  } catch (e) { out.scout = { fout: e.message }; }
  // Wekelijkse analyse (maandag): voorstellen voor conversie en vindbaarheid uit echte gegevens.
  if (amsParts(now).wd === 1 && await once("weekly_proposals_at", 24 * 6)) { try { out.voorstellen = await weeklyProposals(); } catch (e) { out.voorstellen = { fout: e.message }; } }
  return out;
}
