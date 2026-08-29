import { getMission } from "@/lib/mission/repo";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getMission(id);
  if (!m) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ mission: m }, { headers: { "cache-control": "no-store" } });
}
