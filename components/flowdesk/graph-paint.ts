import { relationLabel, type MapEdge, type MapGroup, type SimulationNode } from "./graph-model";

export type GraphTheme = "dark" | "light";
export const graphStyle = {
  dark: { background: "#1c1c22", text: "#b5b4c2", strong: "#eeecf8", group: "#9793aa", accent: "#ba9ff2", edge: "rgba(153,150,173,.22)", edgeDim: "rgba(153,150,173,.045)", edgeActive: "rgba(183,154,237,.78)", labelOutline: "#1c1c22" },
  light: { background: "#f9f7f2", text: "#716a7a", strong: "#363047", group: "#81728a", accent: "#8c679a", edge: "rgba(133,113,135,.19)", edgeDim: "rgba(133,113,135,.045)", edgeActive: "rgba(141,98,152,.75)", labelOutline: "#f9f7f2" },
} satisfies Record<GraphTheme, Record<string, string>>;

export function nodeTone(color: string, theme: GraphTheme) {
  if (theme === "light") return color;
  const hex = color.replace("#", "");
  return "#" + [0, 2, 4].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * .6 + 255 * .4).toString(16).padStart(2, "0")).join("");
}

/** Nodes retain a restrained screen size even on a sparse, highly zoomed map. */
export function nodeRadius(node: SimulationNode, scale: number) {
  const base = node.kind === "project" ? 5.6 : 2.5 + Math.min(1.8, Math.sqrt(node.degree) * .38);
  return base * Math.max(.65, Math.min(1.25, scale)) / scale;
}

export function paintNode(node: SimulationNode, ctx: CanvasRenderingContext2D, scale: number, theme: GraphTheme, activeId: string | null, neighbors: Set<string> | null) {
  const style = graphStyle[theme], x = node.x || 0, y = node.y || 0;
  const active = node.id === activeId, nearby = neighbors?.has(node.id);
  const radius = nodeRadius(node, scale), tone = active ? style.accent : nodeTone(node.color, theme);
  ctx.save(); ctx.globalAlpha = neighbors && !nearby ? .18 : 1;
  if (active) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 22 / scale);
    glow.addColorStop(0, theme === "dark" ? "rgba(182,149,241,.2)" : "rgba(148,110,164,.14)"); glow.addColorStop(1, "rgba(150,120,190,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, 22 / scale, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.beginPath();
  if (node.kind === "project") {
    for (let i = 0; i <= 6; i++) { const a = i * Math.PI / 3 - Math.PI / 6; if (i === 0) ctx.moveTo(x + radius * Math.cos(a), y + radius * Math.sin(a)); else ctx.lineTo(x + radius * Math.cos(a), y + radius * Math.sin(a)); }
  } else if (node.kind === "task") ctx.roundRect(x - radius, y - radius, radius * 2, radius * 2, 1.4 / scale);
  else ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = node.degree ? tone : style.background;
  ctx.strokeStyle = tone; ctx.lineWidth = .9 / scale;
  ctx.fill(); ctx.stroke();
  if (active) { ctx.beginPath(); ctx.arc(x, y, radius + 4 / scale, 0, 2 * Math.PI); ctx.strokeStyle = style.accent; ctx.globalAlpha = .55; ctx.lineWidth = 1 / scale; ctx.stroke(); }
  if (node.fx != null) { ctx.globalAlpha = .8; ctx.beginPath(); ctx.arc(x + radius + 1 / scale, y - radius - 1 / scale, 1.2 / scale, 0, 2 * Math.PI); ctx.fillStyle = style.text; ctx.fill(); }
  ctx.restore();
}

export type GroupMembers = Map<string, SimulationNode[]>;
export function paintClusters(ctx: CanvasRenderingContext2D, theme: GraphTheme, members: GroupMembers, activeNeighbors: Set<string> | null) {
  ctx.save();
  for (const nodes of members.values()) {
    if (nodes.length < 3) continue;
    const x = nodes.reduce((s, n) => s + (n.x || 0), 0) / nodes.length;
    const y = nodes.reduce((s, n) => s + (n.y || 0), 0) / nodes.length;
    const r = Math.max(80, Math.sqrt(nodes.reduce((s, n) => s + ((n.x || 0) - x) ** 2 + ((n.y || 0) - y) ** 2, 0) / nodes.length) * 1.8);
    const tone = nodeTone(nodes[0].color, theme);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, tone + (activeNeighbors && !nodes.some(n => activeNeighbors.has(n.id)) ? "03" : theme === "dark" ? "0a" : "07"));
    glow.addColorStop(1, tone + "00"); ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.restore();
}

type LabelOptions = { theme: GraphTheme; nodes: SimulationNode[]; groups: MapGroup[]; members: GroupMembers; activeId: string | null; neighbors: Set<string> | null; hoveredEdge?: MapEdge; nodeMap: Map<string, SimulationNode> };
const truncate = (text: string, length: number) => text.length <= length ? text : text.slice(0, length - 1) + "…";
export function paintLabels(ctx: CanvasRenderingContext2D, scale: number, options: LabelOptions) {
  const { theme, nodes, groups, members, activeId, neighbors, hoveredEdge, nodeMap } = options;
  const style = graphStyle[theme], boxes: { x: number; y: number; w: number; h: number }[] = [];
  ctx.save();
  const draw = (text: string, x: number, y: number, font: number, color: string, important = false, weight = 400, secondLine?: string) => {
    ctx.font = `${weight} ${font / scale}px "Segoe UI", Arial, sans-serif`;
    const w = ctx.measureText(text).width + 12 / scale, h = (font + (secondLine ? 24 : 9)) / scale;
    const box = { x: x - w / 2, y: y - 3 / scale, w, h };
    if (!important && boxes.some(r => r.x < box.x + w && r.x + r.w > box.x && r.y < box.y + h && r.y + r.h > box.y)) return;
    boxes.push(box);
    ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.lineJoin = "round";
    // An outline follows the glyphs. No rectangular cards cover the network.
    ctx.strokeStyle = style.labelOutline; ctx.lineWidth = 3.5 / scale;
    ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
    if (secondLine) { ctx.font = `400 ${10 / scale}px "Segoe UI", Arial, sans-serif`; ctx.fillStyle = style.group; ctx.fillText(secondLine, x, y + 18 / scale); }
  };
  const active = activeId ? nodeMap.get(activeId) : undefined;
  if (active) draw(truncate(active.label, 70), active.x || 0, (active.y || 0) + 15 / scale, 12, style.strong, true, 600);
  if (nodes.length >= 24 && scale < 1.35) for (const group of groups) {
    const list = members.get(group.id) || [];
    if (list.length < 3 || neighbors && !list.some(n => neighbors.has(n.id))) continue;
    const x = list.reduce((s, n) => s + (n.x || 0), 0) / list.length;
    const y = Math.min(...list.map(n => n.y || 0)) - 48 / scale;
    draw(truncate(group.label.toLocaleUpperCase("vi"), 32), x, y, 12, style.group, false, 600, `${list.length} mục`);
  }
  const sparse = nodes.length <= 24;
  const candidates = nodes.filter(n => n.id !== activeId && (sparse || scale > 1.35 || n.kind === "project" || neighbors?.has(n.id))).sort((a, b) => Number(b.kind === "project") - Number(a.kind === "project") || b.degree - a.degree);
  for (const node of candidates.slice(0, scale > 2 ? 100 : 55)) {
    if (neighbors && !neighbors.has(node.id)) continue;
    draw(truncate(node.label, sparse || scale > 2 ? 44 : 28), node.x || 0, (node.y || 0) + 13 / scale, 10.5, style.text);
  }
  if (hoveredEdge) {
    const a = nodeMap.get(hoveredEdge.source), b = nodeMap.get(hoveredEdge.target);
    if (a && b) draw(relationLabel[hoveredEdge.relationType] || hoveredEdge.relationType, ((a.x || 0) + (b.x || 0)) / 2, ((a.y || 0) + (b.y || 0)) / 2, 11, style.accent, true, 600);
  }
  ctx.restore();
  return boxes.length;
}

/** A sparse graph should not auto-fit into giant dots. */
export function cameraFrame(nodes: SimulationNode[], width: number, height: number) {
  if (!nodes.length) return { x: 0, y: 0, zoom: 1 };
  const xs = nodes.map(n => n.x || 0), ys = nodes.map(n => n.y || 0);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(220, maxX - minX), spanY = Math.max(200, maxY - minY);
  const padding = width < 500 ? 100 : 150;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: Math.max(.08, Math.min(nodes.length < 20 ? 1.65 : 2.3, (width - padding) / spanX, (height - 170) / spanY)) };
}
