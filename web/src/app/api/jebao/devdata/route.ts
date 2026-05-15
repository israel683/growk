/**
 * Diagnostic: fetch the current attribute state of the bound Jebao doser
 * directly from Gizwits' /app/devdata/{did}/latest endpoint. Returns the
 * raw `attr` map so we can see exact attribute names (channe1 vs channel_1
 * vs pump1 etc.) and current values.
 *
 * Useful after a firmware update / device reset to verify that the names
 * our code sends actually match what the device exposes.
 */
import { NextResponse } from "next/server";

const JEBAO_AQUA_APP_ID = "c3703c4888ec4736a3a0d9425c321604";
const REGION_URLS: Record<string, { login: string; bind: string; data: (did: string) => string }> = {
  eu: {
    login: "https://euaepapp.gizwits.com/app/smart_home/login/pwd",
    bind: "https://euapi.gizwits.com/app/bindings",
    data: (did) => `https://euapi.gizwits.com/app/devdata/${did}/latest`,
  },
  us: {
    login: "https://usaepapp.gizwits.com/app/smart_home/login/pwd",
    bind: "https://usapi.gizwits.com/app/bindings",
    data: (did) => `https://usapi.gizwits.com/app/devdata/${did}/latest`,
  },
  cn: {
    login: "https://aep-app.gizwits.com/app/smart_home/login/pwd",
    bind: "https://api.gizwits.com/app/bindings",
    data: (did) => `https://api.gizwits.com/app/devdata/${did}/latest`,
  },
};

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
}

export const maxDuration = 15;

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const username = process.env.JEBAO_USERNAME!;
  const password = process.env.JEBAO_PASSWORD!;
  const region = process.env.JEBAO_REGION || "us";

  try {
    // Login
    const loginRes = await fetch(REGION_URLS[region].login, {
      method: "POST",
      headers: {
        "X-Gizwits-Application-Id": JEBAO_AQUA_APP_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appKey: JEBAO_AQUA_APP_ID,
        data: { account: username, password, lang: "en", refreshToken: true },
        version: "1.0",
      }),
    });
    const loginData = (await loginRes.json()) as { data?: { userToken?: string } };
    const token = loginData.data?.userToken;
    if (!token) return NextResponse.json({ error: "login failed", loginData }, { status: 500 });

    // Get bindings
    const bindRes = await fetch(REGION_URLS[region].bind, {
      headers: {
        "X-Gizwits-Application-Id": JEBAO_AQUA_APP_ID,
        "X-Gizwits-User-token": token,
      },
    });
    const bindData = (await bindRes.json()) as { devices?: Array<{ did: string; is_online: boolean; dev_alias: string }> };
    const dev = bindData.devices?.[0];
    if (!dev) return NextResponse.json({ error: "no device bound" }, { status: 404 });

    // Get device data
    const dataRes = await fetch(REGION_URLS[region].data(dev.did), {
      headers: {
        "X-Gizwits-Application-Id": JEBAO_AQUA_APP_ID,
        "X-Gizwits-User-token": token,
      },
    });
    const devdata = await dataRes.json();

    return NextResponse.json({
      did: dev.did,
      dev_alias: dev.dev_alias,
      is_online: dev.is_online,
      devdata,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
