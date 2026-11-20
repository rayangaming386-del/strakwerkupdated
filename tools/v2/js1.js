
/* Dienstenkiezer: wensen in gewone taal. Elke wens is een optie uit CONFIG hierboven, dus de prijzen komen daar vandaan. */
const KIEZER = {
  needs: [
    { id:"beheer",   label:"Zelf teksten en foto's aanpassen" },
    { id:"aanvraag", label:"Aanvragen in mijn WhatsApp" },
    { id:"booking",  label:"Online afspraken plannen" },
    { id:"kenteken", label:"Kentekencheck (RDW)" },
    { id:"taal",     label:"Een extra taal" },
    { id:"gbp",      label:"Vindbaar in Google Maps" },
    { id:"reviews",  label:"Google reviews en routekaart" },
    { id:"logo",     label:"Een logo" },
    { id:"teksten",  label:"Teksten laten schrijven" }
  ]
};
/* Stijlen uit de stijlpreview (de opmaak per stijl staat in de CSS bij [data-style]) */
const STYLES = { strak:"Strak & donker", licht:"Licht & rustig", warm:"Warm & ambachtelijk", stoer:"Stoer & opvallend" };
/* Projecten in de hero: welke site staat op het scherm, de telefoon en het tweede scherm */
const STAGE_SETS = [
  { main:"glow",      phone:"detak",     back:"cartronic" },
  { main:"cartronic", phone:"glow",      back:"vagpro" },
  { main:"vagpro",    phone:"cartronic", back:"detak" },
  { main:"detak",     phone:"vagpro",    back:"glow" }
];
const PROJECTS = { glow:{ name:"Glow & Laser For You", href:"werk/glow" }, vagpro:{ name:"VAGPRO", href:"werk/vagpro" }, detak:{ name:"Sleepdienst De Tak", href:"werk/detak" }, cartronic:{ name:"CarTronic", href:"werk/cartronic" } };

let stijl = null;        /* gevuld zodra de bezoeker een stijl meeneemt in de aanvraag */
let selTouched = false;  /* de bezoeker heeft zelf iets gekozen in de kiezer of calculator */
const afterHooks = [];   /* worden na elke herberekening van de offerte aangeroepen */
/* Naar een onderdeel scrollen (gewoon scrollen van de browser, geen eigen scrollgedrag) */
function goTo(el, off){
  if (!el) return;
  const y = el.getBoundingClientRect().top + scrollY - (off ?? 8);
  window.scrollTo({ top: Math.max(0, y), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
/* Afbeelding pas ophalen als hij nodig is (data-src), en wachten tot hij getoond kan worden */
function ensureImg(img){
  if (img.dataset.src){ if (img.dataset.srcset){ img.srcset = img.dataset.srcset; delete img.dataset.srcset; } img.src = img.dataset.src; delete img.dataset.src; }
  return img.decode ? img.decode().catch(() => {}) : Promise.resolve();
}
