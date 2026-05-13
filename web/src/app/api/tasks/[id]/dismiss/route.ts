import { NextResponse } from "next/server";
import { dismissTask } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const systemId = systemIdFromRequest(req);
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  let response = "";
  try {
    const body = (await req.json()) as { response?: string };
    response = body.response || "";
  } catch {
    // empty body is fine
  }
  await dismissTask(taskId, response, systemId);
  return NextResponse.json({ ok: true });
}
