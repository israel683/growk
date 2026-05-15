/**
 * Last-resort attempt to cancel built-in calibration mode via cloud.
 * Tries several possible values for the CALSet enum AND toggles CALSW
 * true→false (some firmware exits cal only after an explicit toggle).
 *
 * Auth: CRON_SECRET.
 */
import { NextResponse } from "next/server";

const APP_ID = "c3703c4888ec4736a3a0d9425c321604";
const REGIONS: Record<string, { login: string; bind: string; control: (did: string) => string }> = {
  eu: {
    login: "https://euaepapp.gizwits.com/app/smart_home/login/pwd",
    bind: "https://euapi.gizwits.com/app/bindings",
    control: (did) => `https://euapi.gizwits.com/app/control/${did}`,
  },
  us: {
    login: "https://usaepapp.gizwits.com/app/smart_home/login/pwd",
    bind: "https://usapi.gizwits.com/app/bindings",
    control: (did) => `https://usapi.gizwits.com/app/control/${did}`,
  },
  cn: {
    login: "https://aep-app.gizwits.com/app/smart_home/login/pwd",
    bind: "https://api.gizwits.com/app/bindings",
    control: (did) => `https://api.gizwits.com/app/control/${did}`,
  },
};

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const s = process.env.CRON_SECRET || "";
  return Boolean(s && auth === `Bearer ${s}`);
}

async function sendAttrs(
  ctlUrl: string,
  token: string,
  attrs: Record<string, unknown>
): Promise<{ status: number; body: string; sent: Record<string, unknown> }> {
  const r = await fetch(ctlUrl, {
    method: "POST",
    headers: {
      "X-Gizwits-Application-Id": APP_ID,
      "X-Gizwits-User-token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ attrs }),
  });
  return { status: r.status, body: await r.text(), sent: attrs };
}

export const maxDuration = 30;

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const region = process.env.JEBAO_REGION || "us";
  const username = process.env.JEBAO_USERNAME!;
  const password = process.env.JEBAO_PASSWORD!;

  const loginRes = await fetch(REGIONS[region].login, {
    method: "POST",
    headers: { "X-Gizwits-Application-Id": APP_ID, "Content-Type": "application/json" },
    body: JSON.stringify({
      appKey: APP_ID,
      data: { account: username, password, lang: "en", refreshToken: true },
      version: "1.0",
    }),
  });
  const loginData = (await loginRes.json()) as { data?: { userToken?: string } };
  const token = loginData.data?.userToken;
  if (!token) return NextResponse.json({ error: "login failed" }, { status: 500 });

  const bindRes = await fetch(REGIONS[region].bind, {
    headers: { "X-Gizwits-Application-Id": APP_ID, "X-Gizwits-User-token": token },
  });
  const bindData = (await bindRes.json()) as { devices?: Array<{ did: string }> };
  const did = bindData.devices?.[0]?.did;
  if (!did) return NextResponse.json({ error: "no device" }, { status: 404 });
  const ctlUrl = REGIONS[region].control(did);

  // Try a sequence of cancellation strategies. Stop on first that returns 200 + non-error body.
  const strategies: Array<{ name: string; attrs: Record<string, unknown> }> = [
    { name: "CALSW toggle on→off", attrs: { CALSW: true } },
    { name: "CALSW false", attrs: { CALSW: false } },
    { name: "CALSet numeric 0", attrs: { CALSet: 0 } },
    { name: "CALSet empty string", attrs: { CALSet: "" } },
    { name: "CALSet 完成 (done)", attrs: { CALSet: "完成" } },
    { name: "CALSet 取消 (cancel)", attrs: { CALSet: "取消" } },
    { name: "CALSet 关闭 (close)", attrs: { CALSet: "关闭" } },
    { name: "CALSet 校准0", attrs: { CALSet: "校准0" } },
    { name: "switch false + CALSW false combo", attrs: { switch: false, CALSW: false } },
  ];

  const results: Array<{ name: string; status: number; ok: boolean; body: string }> = [];
  for (const strat of strategies) {
    const r = await sendAttrs(ctlUrl, token, strat.attrs);
    results.push({
      name: strat.name,
      status: r.status,
      ok: r.status === 200 && !r.body.includes("error"),
      body: r.body.slice(0, 200),
    });
    // Tiny gap so the device sees them as separate commands
    await new Promise((res) => setTimeout(res, 400));
  }

  return NextResponse.json({ results });
}
