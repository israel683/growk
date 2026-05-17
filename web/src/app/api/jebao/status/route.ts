/**
 * Read-only doser status snapshot.
 *
 * Combines bindings + devdata + an interpretation pass so a single curl
 * tells you everything you need to know about the Jebao MD-4.5 before
 * deciding whether to dose:
 *
 *   - which device is bound (did, dev_alias, product_key, is_online)
 *   - master `switch` state (0 = channels disabled even if toggled)
 *   - per-channel current value (channe1..channe8)
 *   - timer-ON flags (Timer1ON..Timer8ON — any TRUE = autonomous schedule active)
 *   - calibration state (CALSW + CALSet)
 *   - a "diagnosis" string that summarises whether the device is healthy
 *     enough for cloud-driven dosing
 *
 * No writes whatsoever — safe to hit any time, even while the device is
 * stuck in cal mode.  Auth: CRON_SECRET.
 */
import { NextResponse } from "next/server";

const APP_ID = "c3703c4888ec4736a3a0d9425c321604";
const MD45_PRODUCT_KEY = "5ab6019f2dbb4ae7a42b48d2b8ce0530";

const REGIONS: Record<
  string,
  {
    login: string;
    bind: string;
    data: (did: string) => string;
  }
> = {
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
  const s = process.env.CRON_SECRET || "";
  return Boolean(s && auth === `Bearer ${s}`);
}

export const maxDuration = 20;

type Attrs = Record<string, number | boolean | string | null>;

function truthy(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0 && v !== "0";
  return false;
}

function diagnose(attrs: Attrs | undefined, isOnline: boolean): {
  healthy: boolean;
  issues: string[];
  notes: string[];
} {
  const issues: string[] = [];
  const notes: string[] = [];

  if (!isOnline) issues.push("device is OFFLINE — no cloud control will reach it");
  if (!attrs) {
    issues.push("no attr map returned from devdata — device may have never reported");
    return { healthy: false, issues, notes };
  }

  // Master switch
  const sw = attrs.switch;
  if (sw === 0 || sw === false) {
    notes.push("master switch is OFF — channel toggles will be silently ignored until set true");
  } else if (sw === 1 || sw === true) {
    notes.push("master switch is ON");
  }

  // Channels currently asserted
  const stuckChannels: number[] = [];
  for (let i = 1; i <= 8; i++) {
    if (truthy(attrs[`channe${i}`])) stuckChannels.push(i);
  }
  if (stuckChannels.length > 0) {
    issues.push(`channels asserted on the device right now: ${stuckChannels.join(", ")} (pumps may be running)`);
  }

  // Timer flags — autonomous schedules
  const activeTimers: number[] = [];
  for (let i = 1; i <= 8; i++) {
    if (truthy(attrs[`Timer${i}ON`])) activeTimers.push(i);
  }
  if (activeTimers.length > 0) {
    notes.push(`Timer flags ON: ${activeTimers.join(", ")} — device may auto-fire on its own schedule`);
  }

  // Calibration
  if (truthy(attrs.CALSW)) {
    issues.push("CALSW=true — calibration switch is asserted");
  }
  const calset = attrs.CALSet;
  if (typeof calset === "string" && calset.length > 0 && calset !== "0") {
    issues.push(`CALSet='${calset}' — device is in calibration mode for that channel`);
  } else if (typeof calset === "number" && calset !== 0) {
    issues.push(`CALSet=${calset} — device may be in calibration mode`);
  }

  return { healthy: issues.length === 0, issues, notes };
}

export async function GET(req: Request) {
  if (!authorized(req))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const region = process.env.JEBAO_REGION || "us";
  const username = process.env.JEBAO_USERNAME;
  const password = process.env.JEBAO_PASSWORD;
  if (!username || !password) {
    return NextResponse.json({ error: "JEBAO_USERNAME / JEBAO_PASSWORD not set" }, { status: 500 });
  }
  const r = REGIONS[region];
  if (!r) return NextResponse.json({ error: `unknown JEBAO_REGION '${region}'` }, { status: 500 });

  // Login
  const loginRes = await fetch(r.login, {
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
  const loginData = (await loginRes.json()) as { data?: { userToken?: string } };
  const token = loginData.data?.userToken;
  if (!token) return NextResponse.json({ error: "login failed", loginData }, { status: 500 });

  // Bindings
  const bindRes = await fetch(r.bind, {
    headers: {
      "X-Gizwits-Application-Id": APP_ID,
      "X-Gizwits-User-token": token,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const bindData = (await bindRes.json()) as {
    devices?: Array<{
      did: string;
      dev_alias?: string;
      product_key?: string;
      is_online?: boolean;
    }>;
  };
  const devices = bindData.devices ?? [];
  const md45 = devices.filter((d) => d.product_key === MD45_PRODUCT_KEY);
  const candidates = md45.length > 0 ? md45 : devices;
  const picked = candidates.find((d) => d.is_online) ?? candidates[0];

  if (!picked) {
    return NextResponse.json(
      {
        region,
        bound_count: 0,
        issue: "no device bound to this Gizwits account",
      },
      { status: 404 }
    );
  }

  // devdata
  const dataRes = await fetch(r.data(picked.did), {
    headers: {
      "X-Gizwits-Application-Id": APP_ID,
      "X-Gizwits-User-token": token,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const devdata = (await dataRes.json()) as {
    attr?: Attrs;
    updated_at?: number;
  };
  const diag = diagnose(devdata.attr, Boolean(picked.is_online));

  // Pull a compact view of the channel + control attrs so the response is
  // human-readable without trawling the full raw_attr dump.
  const channelStates: Record<string, unknown> = {};
  for (let i = 1; i <= 8; i++) {
    channelStates[`channe${i}`] = devdata.attr?.[`channe${i}`] ?? null;
  }
  const timerStates: Record<string, unknown> = {};
  for (let i = 1; i <= 8; i++) {
    timerStates[`Timer${i}ON`] = devdata.attr?.[`Timer${i}ON`] ?? null;
  }

  return NextResponse.json({
    region,
    bound_total: devices.length,
    md45_bound: md45.length,
    selected: {
      did: picked.did,
      dev_alias: picked.dev_alias ?? null,
      product_key: picked.product_key ?? null,
      is_online: Boolean(picked.is_online),
    },
    healthy_for_cloud_dosing: diag.healthy,
    issues: diag.issues,
    notes: diag.notes,
    state: {
      master_switch: devdata.attr?.switch ?? null,
      CALSW: devdata.attr?.CALSW ?? null,
      CALSet: devdata.attr?.CALSet ?? null,
      channels: channelStates,
      timers: timerStates,
    },
    devdata_updated_at: devdata.updated_at ?? null,
    raw_attr: devdata.attr ?? null,
  });
}
