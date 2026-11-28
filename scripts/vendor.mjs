#!/usr/bin/env node
// Kopieert de browserversie van supabase-js naar assets/hq-login/ (de site heeft geen bouwstap
// en laadt geen scripts van een CDN). Opnieuw draaien na het bijwerken van @supabase/supabase-js.
import { copyFileSync, readFileSync } from "node:fs";
const src = "node_modules/@supabase/supabase-js/dist/umd/supabase.js";
const v = JSON.parse(readFileSync("node_modules/@supabase/supabase-js/package.json", "utf8")).version;
copyFileSync(src, "assets/hq-login/supabase.js");
console.log(`supabase-js ${v} → assets/hq-login/supabase.js`);
