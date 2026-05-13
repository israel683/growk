import { NextResponse } from "next/server";
import { getPendingTasks, getTasksByStatus } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";

export const maxDuration = 15;

export async function GET(req: Request) {
  const systemId = systemIdFromRequest(req);
  const { searchParams } = new URL(req.url);
  const status = (searchParams.get("status") || "pending") as
    | "pending"
    | "done"
    | "dismissed"
    | "expired";
  try {
    const tasks =
      status === "pending"
        ? await getPendingTasks(systemId)
        : await getTasksByStatus(status, systemId);
    return NextResponse.json({
      system_id: systemId,
      tasks: tasks.map((t) => ({
        id: t.id,
        system_id: t.system_id,
        created_at: t.created_at.toISOString(),
        type: t.type,
        priority: t.priority,
        title: t.title,
        reason: t.reason,
        payload: t.payload,
        status: t.status,
        expires_at: t.expires_at?.toISOString() || null,
        completed_at: t.completed_at?.toISOString() || null,
        user_response: t.user_response,
        decision_id: t.decision_id,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
