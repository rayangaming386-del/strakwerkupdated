// Rechtsvorm herkennen (bepaalt of bellen voor verkoop mag). Alleen sterke signalen tellen:
// de rechtsvorm in de naam zelf, of de eigen naam direct gevolgd door de rechtsvorm op de eigen
// site. Een webbouwer of betaaldienst met "B.V." in de voettekst telt nooit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { legalFromName, legalFromSite, isRechtspersoon, nameWords } from "../api/_lib/klant/legalform.js";

test("rechtsvorm uit de bedrijfsnaam", () => {
  assert.equal(legalFromName("Autobedrijf Noord B.V.")?.form, "bv");
  assert.equal(legalFromName("Garage Smit BV")?.form, "bv");
  assert.equal(legalFromName("Bouwbedrijf Groot N.V.")?.form, "nv");
  assert.equal(legalFromName("Kapper Jansen v.o.f.")?.form, "vof");
  assert.equal(legalFromName("Stichting Buurtwerk")?.form, "stichting");
  assert.equal(legalFromName("Vereniging Ons Dorp")?.form, "vereniging");
  assert.equal(legalFromName("Coöperatie De Eendracht U.A.")?.form, "cooperatie");
  for (const n of ["Garage BV Noord", "Kapsalon Lotus", "Bakkerij Benv", "Nvidia Store", ""]) assert.equal(legalFromName(n), null, n);
});

test("rechtsvorm van de eigen site: alleen de eigen naam direct vóór de rechtsvorm", () => {
  assert.deepEqual(legalFromSite("Kapsalon Lotus", "<footer>© 2019 Kapsalon Lotus B.V. · Website door Bureau X B.V.</footer>"), { form: "bv", source: "website", evidence: "kapsalon lotus b.v." });
  assert.equal(legalFromSite("Café De Hoek", "<span>&copy; Café&nbsp;de Hoek BV</span>")?.form, "bv", "accenten, entiteiten en hoofdletters");
  assert.equal(legalFromSite("Kapper Jansen", "Kapper Jansen V.O.F. | KvK 12345678")?.form, "vof");
  assert.equal(legalFromSite("Buurtwerk", "Stichting Buurtwerk Zoetermeer")?.form, "stichting");
  // Andermans rechtsvorm of een andere entiteit: niet raden.
  assert.equal(legalFromSite("Kapsalon Lotus", "<p>Website door Bureau Voorbeeld B.V.</p><p>Betalen via Mollie B.V.</p>"), null);
  assert.equal(legalFromSite("Kapsalon Lotus", "© Kapsalon Lotus Holding B.V."), null);
  assert.equal(legalFromSite("Bob", "Bob B.V."), null, "te korte naam: te veel kans op toeval");
  assert.equal(legalFromSite("Kapsalon Lotus", "<script>var x='Kapsalon Lotus B.V.'</script><p>Welkom</p>"), null, "scripts tellen niet");
});

test("rechtspersoon of niet", () => {
  for (const f of ["bv", "nv", "stichting", "vereniging", "cooperatie"]) assert.equal(isRechtspersoon(f), true, f);
  for (const f of ["eenmanszaak", "vof", "maatschap", "cv", "onbekend", null, undefined, "iets"]) assert.equal(isRechtspersoon(f), false, String(f));
  assert.deepEqual(nameWords("Autobedrijf Noord B.V."), ["autobedrijf", "noord"]);
  assert.deepEqual(nameWords("Stichting Buurtwerk"), ["buurtwerk"]);
});
