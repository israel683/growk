import { NextResponse } from "next/server";
import { getSystem, updateSystem, archiveSystem } from "@/lib/db";

export const maxDuration = 15;

function serialize(s: NonNullable<Awaited<ReturnType<typeof getSystem>>>) {
  return {
    ...s,
    created_at: s.created_at.toISOString(),
    archived_at: s.archived_at?.toISOString() ?? null,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sys = await getSystem(id);
  if (!sys) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ system: serialize(sys) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json()) as Partial<{
      name: string;
      status: "active" | "paused" | "archived";
      crop_type: string;
      growth_stage: string;
      reservoir_liters: number;
      system_type: string;
      location: string;
      outdoor: boolean;
      ai_cycle_minutes: number;
      tuya_device_id: string | null;
      notes: string | null;
    }>;
    const updated = await updateSystem(id, body);
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ system: serialize(updated) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await archiveSystem(id);
  return NextResponse.json({ ok: true });
}
