export type NodeKind = "project" | "task" | "note";
export type GroupMode = "project" | "topic";
export type MapNode = {
  id: string; refId: string; kind: NodeKind; label: string; body: string; meta: string;
  group: string; groupLabel: string; color: string; degree: number;
};
export type MapEdge = { id: string; source: string; target: string; relationType: string; sourceLabel?: string | null; sourceInput?: string | null; sourceCapturedAt?: string | null; confidence?: number | null };
export type MapGroup = { id: string; label: string; color: string; count: number; x: number; y: number; radius: number };
export type SimulationNode = MapNode & { x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number };
export type SavedPositions = Record<string, { x: number; y: number }>;
export type GraphInput = {
  projects: { id: string; name: string; area: string; goal: string; deleted_at?: string | null }[];
  tasks: { id: string; title: string; description: string; status: string; project_id: string | null; deleted_at?: string | null }[];
  notes: { id: string; title: string; body: string; tag: string; project_id: string | null; deleted_at?: string | null }[];
  relations: { id: string; source_id: string; source_type: string; target_id: string; target_type: string; relation_type: string; deleted_at?: string | null; status?: string; valid_until?: string | null; source_label?: string | null; source_input?: string | null; source_captured_at?: string | null; confidence?: number | string | null }[];
};

const palette = ["#a85d73", "#4a7c9d", "#8b6eb2", "#aa8538", "#4c8d7f", "#bd7351", "#697cb1", "#8c8c4b"];
export const kindLabel: Record<NodeKind, string> = { project: "Dự án", task: "Công việc", note: "Ghi chú" };
export const relationLabel: Record<string, string> = {
  contains: "Bao gồm", belongs_to: "Thuộc về", requires: "Cần có", blocks: "Cản trở",
  references: "Tham khảo", results_in: "Tạo ra", relates_to: "Liên quan", supersedes: "Thay thế",
};
export function hash(value: string) { let h = 2166136261; for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
export function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase(); }

/** Grouping is a display aid only: no synthetic nodes or relations are inserted. */
export function buildGraph(input: GraphInput, mode: GroupMode = "project") {
  const projects = new Map(input.projects.filter(p => !p.deleted_at).map(p => [p.id, p]));
  const nodes: MapNode[] = [];
  function add(kind: NodeKind, id: string, label: string, body: string, meta: string, projectId: string | null, tag = "") {
    const project = projectId ? projects.get(projectId) : undefined;
    const topic = tag.trim() || "Ghi chú khác";
    const group = kind === "project" || (mode === "project" && project) || kind === "task" && project
      ? `project:${project!.id}` : kind === "task" ? "personal-tasks" : `topic:${normalize(topic)}`;
    const groupLabel = group.startsWith("project:") ? project!.name : group === "personal-tasks" ? "Việc cá nhân" : topic;
    nodes.push({ id: `${kind}:${id}`, refId: id, kind, label, body, meta, group, groupLabel, color: palette[hash(group) % palette.length], degree: 0 });
  }
  for (const p of projects.values()) add("project", p.id, p.name, p.goal, p.area, p.id);
  for (const t of input.tasks.filter(t => !t.deleted_at)) add("task", t.id, t.title, t.description, t.status === "done" ? "Hoàn thành" : t.status === "doing" ? "Đang làm" : "Cần làm", t.project_id);
  for (const n of input.notes.filter(n => !n.deleted_at)) add("note", n.id, n.title, n.body, n.tag || "Ghi chú", n.project_id, n.tag);
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const seen = new Set<string>();
  const edges: MapEdge[] = [];
  for (const r of input.relations) {
    if (r.deleted_at || r.status && r.status !== "active" || r.valid_until && Date.parse(r.valid_until) <= Date.now()) continue;
    const source = `${r.source_type}:${r.source_id}`, target = `${r.target_type}:${r.target_id}`;
    if (source === target || !nodeMap.has(source) || !nodeMap.has(target)) continue;
    const ends = r.relation_type === "relates_to" ? [source, target].sort() : [source, target];
    const key = JSON.stringify([...ends, r.relation_type]);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: key, source, target, relationType: r.relation_type, sourceLabel: r.source_label, sourceInput: r.source_input, sourceCapturedAt: r.source_captured_at, confidence: r.confidence == null ? null : Number(r.confidence) });
    nodeMap.get(source)!.degree++; nodeMap.get(target)!.degree++;
  }
  return { nodes, edges, nodeMap, groups: groupLayout(nodes) };
}

export function groupLayout(nodes: MapNode[]): MapGroup[] {
  const map = new Map<string, MapGroup>();
  for (const n of nodes) {
    if (!map.has(n.group)) map.set(n.group, { id: n.group, label: n.groupLabel, color: n.color, count: 0, x: 0, y: 0, radius: 0 });
    map.get(n.group)!.count++;
  }
  const groups = [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  const spacing = Math.max(190, ...groups.map(g => 80 + Math.sqrt(g.count) * 25));
  if (groups.length === 1) return groups.map(g => ({ ...g, radius: 35 + Math.sqrt(g.count) * 15 }));
  // Phyllotaxis seeds irregular clusters; the actual links settle their positions.
  return groups.map((g, i) => {
    const angle = -Math.PI / 2 + i * 2.399963;
    const orbit = spacing * Math.sqrt(i + .4) * .8;
    return { ...g, x: Math.cos(angle) * orbit, y: Math.sin(angle) * orbit * .85, radius: 35 + Math.sqrt(g.count) * 15 };
  });
}

export function neighborhood(edges: MapEdge[], root: string, depth: number) {
  const adjacent = new Map<string, string[]>();
  for (const e of edges) { adjacent.set(e.source, [...adjacent.get(e.source) || [], e.target]); adjacent.set(e.target, [...adjacent.get(e.target) || [], e.source]); }
  const found = new Set([root]), queue = [{ id: root, depth: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]; if (current.depth >= depth) continue;
    for (const next of adjacent.get(current.id) || []) if (!found.has(next)) { found.add(next); queue.push({ id: next, depth: current.depth + 1 }); }
  }
  return found;
}

export function filterGraph(model: ReturnType<typeof buildGraph>, filters: { kind: string; group: string; showOrphans: boolean; root: string | null; depth: number }) {
  const local = filters.root ? neighborhood(model.edges, filters.root, filters.depth) : null;
  const nodes = model.nodes.filter(n => (filters.kind === "all" || n.kind === filters.kind) && (filters.group === "all" || n.group === filters.group) && (filters.showOrphans || n.degree > 0) && (!local || local.has(n.id)));
  const ids = new Set(nodes.map(n => n.id));
  return { nodes, edges: model.edges.filter(e => ids.has(e.source) && ids.has(e.target)) };
}

export function readPositions(raw: string | null): SavedPositions {
  try {
    const data = JSON.parse(raw || "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([id, p]) => /^(note|task|project):/.test(id) && p && typeof p === "object" && Number.isFinite((p as { x: number }).x) && Number.isFinite((p as { y: number }).y) && Math.abs((p as { x: number }).x) < 100000 && Math.abs((p as { y: number }).y) < 100000)) as SavedPositions;
  } catch { return {}; }
}

/** Reuse simulation objects; selecting or hovering must not restart the layout. */
export function reconcileNodes(cache: Map<string, SimulationNode>, nodes: MapNode[], groups: MapGroup[], saved: SavedPositions) {
  const centers = new Map(groups.map(g => [g.id, g]));
  const index = new Map<string, number>();
  return nodes.map(n => {
    const existing = cache.get(n.id);
    if (existing) { Object.assign(existing, n); return existing; }
    const g = centers.get(n.group)!;
    const i = index.get(n.group) || 0; index.set(n.group, i + 1);
    const angle = hash(n.id) * .0001 + i * 2.39996;
    const radius = n.kind === "project" ? 0 : 20 + Math.sqrt(i) * 17;
    const p = saved[n.id];
    const node: SimulationNode = { ...n, x: p?.x ?? g.x + Math.cos(angle) * radius, y: p?.y ?? g.y + Math.sin(angle) * radius, ...(p ? { fx: p.x, fy: p.y } : {}) };
    cache.set(n.id, node); return node;
  });
}

/** Soft cluster attraction plus grid collision; grouping never creates an edge. */
export function clusterForce(groups: MapGroup[], attraction = .02) {
  const centers = new Map(groups.map(g => [g.id, g]));
  let nodes: SimulationNode[] = [];
  const force = (alpha: number) => {
    const grid = new Map<string, SimulationNode[]>(), cell = 22;
    for (const n of nodes) {
      const g = centers.get(n.group);
      if (g && n.fx == null) {
        n.vx = (n.vx || 0) + (g.x - (n.x || 0)) * attraction * alpha;
        n.vy = (n.vy || 0) + (g.y - (n.y || 0)) * attraction * alpha;
      }
      const gx = Math.floor((n.x || 0) / cell), gy = Math.floor((n.y || 0) / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const other of grid.get(`${gx + dx},${gy + dy}`) || []) {
        let x = (n.x || 0) - (other.x || 0), y = (n.y || 0) - (other.y || 0);
        const min = n.kind === "project" || other.kind === "project" ? 22 : 14;
        if (x === 0 && y === 0) x = .1;
        const d = Math.sqrt(x * x + y * y);
        if (d >= min) continue;
        const strength = (min - d) / d * .25;
        if (n.fx == null) { n.vx = (n.vx || 0) + x * strength; n.vy = (n.vy || 0) + y * strength; }
        if (other.fx == null) { other.vx = (other.vx || 0) - x * strength; other.vy = (other.vy || 0) - y * strength; }
      }
      const key = `${gx},${gy}`; grid.set(key, [...grid.get(key) || [], n]);
    }
  };
  force.initialize = (current: SimulationNode[]) => { nodes = current; };
  return force;
}
