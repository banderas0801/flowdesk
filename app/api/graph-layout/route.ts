import { getRawDb } from "../../../db";
import { getChatGPTUser } from "../../chatgpt-auth";

type LayoutMode = "project" | "topic";
type Positions = Record<string, { x: number; y: number }>;

async function ownerId() {
  const user = await getChatGPTUser();
  if (user) return user.userId;
  return process.env.NODE_ENV !== "production" ? "local-preview" : null;
}

function readMode(value: string | null): LayoutMode | null {
  return value === "project" || value === "topic" ? value : null;
}

async function ensureSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS graph_layouts (
    owner_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    positions_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (owner_id, mode)
  )`).run();
}

function parsePositions(value: unknown): Positions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 5000) return null;
  const result: Positions = {};
  for (const [id, raw] of entries) {
    if (id.length > 180 || !/^(note|task|project):[^\s:][^\n\r]*$/.test(id) || !raw || typeof raw !== "object") return null;
    const { x, y } = raw as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100000 || Math.abs(y) > 100000) return null;
    result[id] = { x, y };
  }
  return result;
}

export async function GET(request: Request) {
  const owner = await ownerId();
  if (!owner) return Response.json({ error: "Đăng nhập để đồng bộ bố cục graph." }, { status: 401 });
  const mode = readMode(new URL(request.url).searchParams.get("mode"));
  if (!mode) return Response.json({ error: "Chế độ bố cục không hợp lệ." }, { status: 400 });
  try {
    const db = getRawDb();
    await ensureSchema(db);
    const row = await db.prepare("SELECT positions_json, updated_at FROM graph_layouts WHERE owner_id = ? AND mode = ? LIMIT 1").bind(owner, mode).first<{ positions_json: string; updated_at: string }>();
    let positions: Positions = {};
    try { positions = row ? parsePositions(JSON.parse(row.positions_json)) || {} : {}; } catch { positions = {}; }
    return Response.json({ positions, updatedAt: row?.updated_at || null });
  } catch (error) {
    console.error("graph layout read failed", error);
    return Response.json({ error: "Không thể tải bố cục graph." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const owner = await ownerId();
  if (!owner) return Response.json({ error: "Đăng nhập để lưu bố cục graph." }, { status: 401 });
  try {
    const body = await request.json() as { mode?: unknown; positions?: unknown };
    const mode = readMode(typeof body.mode === "string" ? body.mode : null);
    const positions = parsePositions(body.positions);
    if (!mode || !positions) return Response.json({ error: "Dữ liệu bố cục không hợp lệ." }, { status: 400 });
    const db = getRawDb();
    await ensureSchema(db);
    const updatedAt = new Date().toISOString();
    await db.prepare(`INSERT INTO graph_layouts (owner_id, mode, positions_json, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(owner_id, mode) DO UPDATE SET positions_json = excluded.positions_json, updated_at = excluded.updated_at`)
      .bind(owner, mode, JSON.stringify(positions), updatedAt).run();
    return Response.json({ ok: true, updatedAt, count: Object.keys(positions).length });
  } catch (error) {
    console.error("graph layout save failed", error);
    return Response.json({ error: "Không thể lưu bố cục graph." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const owner = await ownerId();
  if (!owner) return Response.json({ error: "Đăng nhập để đặt lại bố cục graph." }, { status: 401 });
  const mode = readMode(new URL(request.url).searchParams.get("mode"));
  if (!mode) return Response.json({ error: "Chế độ bố cục không hợp lệ." }, { status: 400 });
  try {
    const db = getRawDb();
    await ensureSchema(db);
    await db.prepare("DELETE FROM graph_layouts WHERE owner_id = ? AND mode = ?").bind(owner, mode).run();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("graph layout reset failed", error);
    return Response.json({ error: "Không thể đặt lại bố cục graph." }, { status: 503 });
  }
}
