/**
 * Coordinated "panic stop" + before/after diagnostic.
 *
 * Single transaction that sets EVERYTHING off — master switch, all 8 channels,
 * all 8 timer-on flags, CALSW — then waits and re-reads devdata so we can see
 * exactly which attrs the firmware accepted vs reverted while in cal mode.
 *
 * Auth: CRON_SECRET.
 */
import { NextResponse } from "next/server";

const APP_ID = "c3703c4888ec4736a3a0d9425c321604";
const REGIONS: Record<
  string,
  {
    login: string;
    bind: string;
    control: (did: string) => string;
    data: (did: string) => string;
  }
> = {
  eu: {
    login: "https://euaepapp.gizwits.com/app/smart_home/login/pwd",
    bind: "https://euapi.gizwits.com/app/bindings",
    control: (did) => `https://euapi.gizwits.com/app/control/${did}`,
    data: (did) => `https://euapi.gizwits.com/app/devdata/${did}/latest`,
  },
  us: {
    login: "https://usaepapp.gizwits.com/app/smart_home/login/pwd",
    bind: "https://usapi.gizwits.com/app/bindings",
    control: (did) => `https://usapi.gizwits.com/app/control/${did}`,
    data: (did) => `https://usapi.gizwits.com/app/devdata/${did}/latest`,
  },
  cn: {
    login: "https://aep-app.gizwits.com/app/smart_home/login/pwd",
    bind: "https://api.gizwits.com/app/bindings",
    control: (did) => `https://api.gizwits.com/app/control/${did}`,
    data: (did) => `https://api.gizwits.com/app/devdata/${did}/latest`,
  },
};

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const s = process.env.CRON_SECRET || "";
  return Boolean(s && auth === `Bearer ${s}`);
}

export const maxDuration = 30;

export async function POST(req: Request) {
  if (!authorized(req))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const region = process.env.JEBAO_REGION || "us";
  const username = process.env.JEBAO_USERNAME!;
  const password = process.env.JEBAO_PASSWORD!;

  // Login
  const loginRes = await fetch(REGIONS[region].login, {
    method: "POST",
    headers: {
      "X-Gizwits-Application-Id": APP_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      appKey: APP_ID,
      data: { account: username, password, lang: "en", refreshToken: true },
      version: "1.0",
    }),
  });
  const loginData = (await loginRes.json()) as {
    data?: { userToken?: string };
  };
  const token = loginData.data?.userToken;
  if (!token)
    return NextResponse.json({ error: "login failed" }, { status: 500 });

  // Bindings
  const bindRes = await fetch(REGIONS[region].bind, {
    headers: {
      "X-Gizwits-Application-Id": APP_ID,
      "X-Gizwits-User-token": token,
    },
  });
  const bindData = (await bindRes.json()) as {
    devices?: Array<{ did: string; is_online?: boolean; dev_alias?: string }>;
  };
  const dev = bindData.devices?.[0];
  if (!dev)
    return NextResponse.json({ error: "no device" }, { status: 404 });

  const ctlUrl = REGIONS[region].control(dev.did);
  const dataUrl = REGIONS[region].data(dev.did);

  // BEFORE snapshot
  const beforeRes = await fetch(dataUrl, {
    headers: {
      "X-Gizwits-Application-Id": APP_ID,
      "X-Gizwits-User-token": token,
    },
  });
  const before = (await beforeRes.json()) as { attr?: Record<string, unknown> };

  // One coordinated panic batch.  No read-only attrs (Calib1..5 omitted) so
  // Gizwits won't bounce the whole batch with 9025.
  const panicAttrs: Record<string, boolean> = {
    switch: false,
    CALSW: false,
  };
  for (let i = 1; i <= 8; i++) {
    panicAttrs[`channe${i}`] = false;
    panicAttrs[`Timer${i}ON`] = false;
  }

  const ctlRes = await fetch(ctlUrl, {
    method: "POST",
    headers: {
      "X-Gizwits-Application-Id": APP_ID,
      "X-Gizwits-User-token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ attrs: panicAttrs }),
  });
  const ctlBody = await ctlRes.text();

  // Give the device a moment to settle before re-reading.
  await new Promise((res) => setTimeout(res, 2000));

  // AFTER snapshot
  const afterRes = await fetch(dataUrl, {
    headers: {
      "X-Gizwits-Application-Id": APP_ID,
      "X-Gizwits-User-token": token,
    },
  });
  const after = (await afterRes.json()) as { attr?: Record<string, unknown> };

  // Diff: only attrs that we tried to set + anything that changed
  const diff: Record<string, { before: unknown; after: unknown; intended: unknown; stuck: boolean }> = {};
  for (const k of Object.keys(panicAttrs)) {
    const b = before.attr?.[k];
    const a = after.attr?.[k];
    diff[k] = {
      before: b,
      after: a,
      intended: panicAttrs[k],
      // "stuck" = firmware reverted or never accepted the write
      stuck: a !== false && a !== 0,
    };
  }

  return NextResponse.json({
    did: dev.did,
    dev_alias: dev.dev_alias,
    is_online: dev.is_online,
    control: {
      status: ctlRes.status,
      body: ctlBody.slice(0, 300),
    },
    diff,
    raw_before: before.attr,
    raw_after: after.attr,
  });
}
