#!/usr/bin/env node
// One-shot Jebao MD-4.5 read-only status probe.
// Reads JEBAO_USERNAME / JEBAO_PASSWORD / JEBAO_REGION from .env.diagnostic
// (pulled via `vercel env pull`) and queries Gizwits Cloud directly.
// No writes; safe to run any time.

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.diagnostic", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      const k = l.slice(0, i);
      let v = l.slice(i + 1);
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      return [k, v];
    })
);

const APP_ID = "c3703c4888ec4736a3a0d9425c321604";
const MD45_PK = "5ab6019f2dbb4ae7a42b48d2b8ce0530";
const region = env.JEBAO_REGION || "us";
const REGIONS = {
  eu: { login: "https://euaepapp.gizwits.com/app/smart_home/login/pwd",
        bind:  "https://euapi.gizwits.com/app/bindings",
        data:  (d) => `https://euapi.gizwits.com/app/devdata/${d}/latest` },
  us: { login: "https://usaepapp.gizwits.com/app/smart_home/login/pwd",
        bind:  "https://usapi.gizwits.com/app/bindings",
        data:  (d) => `https://usapi.gizwits.com/app/devdata/${d}/latest` },
  cn: { login: "https://aep-app.gizwits.com/app/smart_home/login/pwd",
        bind:  "https://api.gizwits.com/app/bindings",
        data:  (d) => `https://api.gizwits.com/app/devdata/${d}/latest` },
};
const r = REGIONS[region];

console.log(`[probe] region=${region}, user=${env.JEBAO_USERNAME}`);

const login = await fetch(r.login, {
  method: "POST",
  headers: { "X-Gizwits-Application-Id": APP_ID, "Content-Type": "application/json" },
  body: JSON.stringify({
    appKey: APP_ID,
    data: { account: env.JEBAO_USERNAME, password: env.JEBAO_PASSWORD, lang: "en", refreshToken: true },
    version: "1.0",
  }),
}).then((r) => r.json());

const token = login?.data?.userToken;
if (!token) {
  console.error("[probe] login failed:", JSON.stringify(login));
  process.exit(1);
}
console.log("[probe] login OK");

const bind = await fetch(r.bind, {
  headers: { "X-Gizwits-Application-Id": APP_ID, "X-Gizwits-User-token": token },
}).then((r) => r.json());

const devices = bind?.devices || [];
console.log(`[probe] bound devices: ${devices.length}`);
for (const d of devices) {
  console.log(`  - did=${d.did}  alias=${d.dev_alias ?? "?"}  pk=${d.product_key ?? "?"}  online=${d.is_online}  md45=${d.product_key === MD45_PK}`);
}
const md45 = devices.filter((d) => d.product_key === MD45_PK);
const candidates = md45.length > 0 ? md45 : devices;
const picked = candidates.find((d) => d.is_online) ?? candidates[0];
if (!picked) {
  console.error("[probe] no devices bound — nothing to read");
  process.exit(2);
}

console.log(`\n[probe] selected: did=${picked.did} alias=${picked.dev_alias} online=${picked.is_online}\n`);

const data = await fetch(r.data(picked.did), {
  headers: { "X-Gizwits-Application-Id": APP_ID, "X-Gizwits-User-token": token },
}).then((r) => r.json());

const attr = data?.attr || {};
const truthy = (v) => v === true || (typeof v === "number" && v !== 0) || (typeof v === "string" && v.length > 0 && v !== "0");

console.log("=== STATE ===");
console.log("master switch :", attr.switch);
console.log("CALSW         :", attr.CALSW);
console.log("CALSet        :", JSON.stringify(attr.CALSet));
console.log("");
console.log("channels (asserted means pump may be running RIGHT NOW):");
for (let i = 1; i <= 8; i++) {
  const v = attr[`channe${i}`];
  if (v !== undefined) {
    const mark = truthy(v) ? " ← ASSERTED" : "";
    console.log(`  channe${i}: ${v}${mark}`);
  }
}
console.log("");
console.log("timer-ON flags (any TRUE = autonomous schedule active):");
for (let i = 1; i <= 8; i++) {
  const v = attr[`Timer${i}ON`];
  if (v !== undefined) {
    const mark = truthy(v) ? " ← AUTONOMOUS" : "";
    console.log(`  Timer${i}ON: ${v}${mark}`);
  }
}

console.log("\n=== DIAGNOSIS ===");
const issues = [];
const notes = [];
if (!picked.is_online) issues.push("DEVICE OFFLINE");
if (attr.switch === 0 || attr.switch === false) notes.push("master switch=OFF (cloud channel toggles will be silently ignored until set true)");
else notes.push("master switch=ON");
const stuck = [];
for (let i = 1; i <= 8; i++) if (truthy(attr[`channe${i}`])) stuck.push(i);
if (stuck.length) issues.push(`channels currently asserted: ${stuck.join(", ")} (pumps may be running)`);
const timers = [];
for (let i = 1; i <= 8; i++) if (truthy(attr[`Timer${i}ON`])) timers.push(i);
if (timers.length) notes.push(`active Timer flags: ${timers.join(", ")} — device may fire on its own schedule`);
if (truthy(attr.CALSW)) issues.push("CALSW=true (calibration switch asserted)");
if (attr.CALSet && attr.CALSet !== 0 && attr.CALSet !== "0") issues.push(`CALSet=${JSON.stringify(attr.CALSet)} — device is in calibration mode`);

if (issues.length === 0) {
  console.log("✅ HEALTHY for cloud-driven dosing.");
} else {
  console.log("❌ ISSUES:");
  for (const x of issues) console.log("  - " + x);
}
if (notes.length) {
  console.log("\nNOTES:");
  for (const x of notes) console.log("  - " + x);
}

console.log("\n=== RAW attr (for debugging) ===");
console.log(JSON.stringify(attr, null, 2));
