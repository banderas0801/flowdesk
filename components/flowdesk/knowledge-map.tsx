"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type Ref } from "react";
import type { ForceGraphMethods, ForceGraphProps } from "react-force-graph-2d";
import { ChevronDown, ChevronRight, Compass, Expand, FileText, Folder, ListTodo, LocateFixed, Minimize2, Minus, Moon, Network, PanelLeft, PinOff, Plus, RotateCcw, Search, SlidersHorizontal, Sun, X } from "lucide-react";
import { buildGraph, clusterForce, filterGraph, groupLayout, kindLabel, neighborhood, normalize, readPositions, reconcileNodes, relationLabel, type GraphInput, type GroupMode, type MapEdge, type MapNode, type SavedPositions, type SimulationNode } from "./graph-model";
import { cameraFrame, graphStyle, nodeTone, paintClusters, paintLabels, paintNode, type GraphTheme } from "./graph-paint";

// Load Canvas only in the browser; server-render the controls and accessible list.
type EdgeData = Omit<MapEdge, "source" | "target">;
// Upstream ref types omit React callback refs, which the component forwards.
const ForceGraph = dynamic(() => import("react-force-graph-2d"), { ssr: false, loading: () => <div className="km-loading">Đang mở bản đồ…</div> }) as unknown as ComponentType<ForceGraphProps<SimulationNode, EdgeData> & { ref?: Ref<ForceGraphMethods<SimulationNode, EdgeData>> }>;
type RenderEdge = Omit<MapEdge, "source" | "target"> & { source: string | SimulationNode; target: string | SimulationNode };
const endpoint = (value: string | SimulationNode) => typeof value === "string" ? value : value.id;
const positionKey = (mode: GroupMode) => `flowdesk:knowledge-map:v1:${mode}`;
const iconFor = (kind: MapNode["kind"]) => kind === "project" ? Folder : kind === "task" ? ListTodo : FileText;
const tooltipText = (text: string, max = 42) => text.length > max ? text.slice(0, max - 1) + "…" : text;

export function KnowledgeMap({ notes, tasks, projects, relations, query = "", onOpen, onCreate }: GraphInput & { query?: string; onOpen: (node: MapNode) => void; onCreate: () => void }) {
  const [mode, setMode] = useState<GroupMode>("project");
  const [arrangement, setArrangement] = useState<"natural" | "cluster">("natural");
  const [theme, setTheme] = useState<GraphTheme>("dark");
  const [libraryVisible, setLibraryVisible] = useState(true);
  const [kind, setKind] = useState("all");
  const [group, setGroup] = useState("all");
  const [showOrphans, setShowOrphans] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [localRoot, setLocalRoot] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [search, setSearch] = useState(query);
  const [sidebar, setSidebar] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [storageState, setStorageState] = useState("");
  const [, refreshPins] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 600 });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // The library owns mutable coordinates; view state must keep these objects alive.
  const cache = useRef(new Map<string, SimulationNode>());
  const saved = useRef<SavedPositions>({});
  const graph = useRef<any>(null);
  const surface = useRef<HTMLDivElement>(null);
  const fitPending = useRef(true);
  const focusPending = useRef<string | null>(null);
  const shell = useRef<HTMLElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const layoutSaveTimer = useRef<number | null>(null);
  const reduceMotion = useRef(false);
  const attachGraph = useCallback((instance: unknown) => { graph.current = instance; if (instance) setReady(value => value + 1); }, []);

  const model = useMemo(() => buildGraph({ notes, tasks, projects, relations }, mode), [notes, tasks, projects, relations, mode]);
  const view = useMemo(() => filterGraph(model, { kind, group, showOrphans, root: localRoot, depth }), [model, kind, group, showOrphans, localRoot, depth]);
  const groups = useMemo(() => groupLayout(view.nodes), [view]);
  const graphData = useMemo(() => ({
    nodes: reconcileNodes(cache.current, view.nodes, groups, saved.current),
    links: view.edges.map(edge => ({ ...edge })) as RenderEdge[],
    // layoutVersion applies a saved layout or resets it, never changes graph content.
  }), [view, groups, layoutVersion]);
  const selected = selectedId ? model.nodeMap.get(selectedId) : undefined;
  const activeId = hoverId || selectedId;
  const neighbors = useMemo(() => activeId ? neighborhood(model.edges, activeId, 1) : null, [model.edges, activeId]);
  const selectedEdges = useMemo(() => model.edges.filter(edge => edge.source === selectedId || edge.target === selectedId), [model.edges, selectedId]);
  const hoveredRelation = model.edges.find(edge => edge.id === hoverEdge);
  const selectedRelation = model.edges.find(edge => edge.id === selectedEdgeId);
  const searchResults = useMemo(() => search.trim() ? model.nodes.filter(node => normalize(node.label + " " + node.meta + " " + node.groupLabel).includes(normalize(search.trim()))).slice(0, 60) : [], [model.nodes, search]);
  const visibleIds = useMemo(() => new Set(view.nodes.map(n => n.id)), [view]);
  const membersByGroup = useMemo(() => {
    const map = new Map<string, SimulationNode[]>();
    for (const node of graphData.nodes) { const list = map.get(node.group); if (list) list.push(node); else map.set(node.group, [node]); }
    return map;
  }, [graphData]);

  useEffect(() => { setSearch(query); }, [query]);
  useEffect(() => { try { const savedTheme = localStorage.getItem("flowdesk:graph-theme"); if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme); } catch {} }, []);
  const changeTheme = (value: GraphTheme) => { setTheme(value); try { localStorage.setItem("flowdesk:graph-theme", value); } catch {} };
  useEffect(() => {
    if (selectedId && !model.nodeMap.has(selectedId)) { setSelectedId(null); setLocalRoot(null); }
    if (localRoot && !model.nodeMap.has(localRoot)) setLocalRoot(null);
    if (group !== "all" && !model.groups.some(g => g.id === group)) setGroup("all");
    // Drop deleted nodes from the simulation cache without discarding filtered nodes.
    for (const id of cache.current.keys()) if (!model.nodeMap.has(id)) cache.current.delete(id);
  }, [model, selectedId, group, localRoot]);
  useEffect(() => {
    try { saved.current = readPositions(localStorage.getItem(positionKey(mode))); }
    catch { saved.current = {}; setStorageState("Trình duyệt đang chặn lưu vị trí."); }
    cache.current.clear(); fitPending.current = true; setLayoutVersion(v => v + 1);
    let active = true;
    setStorageState("Đang đồng bộ bố cục…");
    fetch(`/api/graph-layout?mode=${mode}`, { cache: "no-store" }).then(async response => {
      const payload = await response.json() as { positions?: unknown };
      if (!response.ok) throw new Error("Không thể tải bố cục.");
      if (!active) return;
      const cloud = readPositions(JSON.stringify(payload.positions || {}));
      if (Object.keys(cloud).length) {
        saved.current = cloud;
        try { localStorage.setItem(positionKey(mode), JSON.stringify(cloud)); } catch {}
        cache.current.clear(); fitPending.current = true; setLayoutVersion(v => v + 1);
        setStorageState("Bố cục đã đồng bộ giữa các thiết bị.");
      } else {
        const local = saved.current;
        if (Object.keys(local).length) {
          fetch("/api/graph-layout", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, positions: local }) })
            .then(response => { if (!response.ok) throw new Error(); if (active) setStorageState("Bố cục đã đồng bộ giữa các thiết bị."); })
            .catch(() => { if (active) setStorageState("Chỉ lưu bố cục trên thiết bị này."); });
        } else setStorageState("Bố cục sẽ đồng bộ khi ghim node.");
      }
    }).catch(() => { if (active) setStorageState("Chỉ lưu bố cục trên thiết bị này."); });
    return () => { active = false; if (layoutSaveTimer.current != null) window.clearTimeout(layoutSaveTimer.current); };
  }, [mode]);
  useEffect(() => {
    reduceMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const element = surface.current; if (!element) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setSize(previous => previous.width === Math.round(width) && previous.height === Math.round(height) ? previous : { width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!graph.current) return;
    graph.current.d3Force("cluster", clusterForce(groups, arrangement === "natural" ? .006 : .03));
    graph.current.d3Force("charge")?.strength(-90);
    graph.current.d3Force("link")?.distance((edge: RenderEdge) => {
      const a = model.nodeMap.get(endpoint(edge.source)), b = model.nodeMap.get(endpoint(edge.target));
      return a?.group === b?.group || arrangement === "natural" ? 62 : 210;
    }).strength(.2);
    graph.current.d3ReheatSimulation();
  }, [ready, graphData, groups, model.nodeMap, arrangement]);
  useEffect(() => { fitPending.current = true; }, [view]);
  useEffect(() => {
    if (!fullscreen) return;
    const old = document.body.style.overflow;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    shell.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setFullscreen(false); return; }
      if (event.key !== "Tab" || !shell.current) return;
      const elements = [...shell.current.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]')].filter(e => e.getClientRects().length);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === shell.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = old; document.removeEventListener("keydown", key); restoreFocus.current?.focus(); };
  }, [fullscreen]);

  const fit = useCallback(() => {
    if (!graph.current || !size.width) return;
    const frame = cameraFrame(graphData.nodes, size.width, size.height), duration = reduceMotion.current ? 0 : 450;
    graph.current.centerAt(frame.x, frame.y, duration); graph.current.zoom(frame.zoom, duration);
  }, [graphData, size.width, size.height]);
  useEffect(() => {
    if (!ready || !size.width || !fitPending.current) return;
    const timer = window.setTimeout(fit, reduceMotion.current ? 0 : 320);
    return () => window.clearTimeout(timer);
  }, [ready, size.width, size.height, fit]);

  const selectNode = useCallback((id: string, moveCamera = true) => {
    setSelectedId(id); setHoverId(null); setHoverEdge(null); setSidebar(false);
    fitPending.current = false;
    const node = model.nodeMap.get(id);
    if (!node) return;
    if (!visibleIds.has(id)) { setKind("all"); setGroup("all"); setShowOrphans(true); setLocalRoot(null); focusPending.current = id; }
    else if (moveCamera) { const n = cache.current.get(id); if (n) graph.current?.centerAt(n.x, n.y, reduceMotion.current ? 0 : 400); }
  }, [model.nodeMap, visibleIds]);
  const settle = () => {
    const id = focusPending.current;
    if (id) {
      const n = cache.current.get(id);
      if (n) { graph.current?.centerAt(n.x, n.y, reduceMotion.current ? 0 : 400); graph.current?.zoom(1.5, reduceMotion.current ? 0 : 400); focusPending.current = null; fitPending.current = false; }
    } else if (fitPending.current) { fit(); fitPending.current = false; }
  };
  const persist = () => {
    // Keep only pins for living nodes. Coordinates are local to this browser.
    const next = { ...saved.current };
    for (const [id, node] of cache.current) {
      if (node.fx != null && node.fy != null) next[id] = { x: node.fx, y: node.fy };
      else delete next[id];
    }
    saved.current = Object.fromEntries(Object.entries(next).filter(([id]) => model.nodeMap.has(id)));
    refreshPins(v => v + 1);
    try { localStorage.setItem(positionKey(mode), JSON.stringify(saved.current)); setStorageState("Đang lưu bố cục…"); }
    catch { setStorageState("Không lưu được vị trí; bản đồ vẫn dùng được."); }
    if (layoutSaveTimer.current != null) window.clearTimeout(layoutSaveTimer.current);
    const snapshot = saved.current;
    layoutSaveTimer.current = window.setTimeout(() => {
      fetch("/api/graph-layout", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, positions: snapshot }) })
        .then(response => { if (!response.ok) throw new Error(); setStorageState("Bố cục đã đồng bộ giữa các thiết bị."); })
        .catch(() => setStorageState("Chỉ lưu bố cục trên thiết bị này."));
    }, 350);
  };
  const dragEnd = (node: SimulationNode) => { fitPending.current = false; node.fx = node.x; node.fy = node.y; persist(); };
  const unpin = () => {
    if (!selectedId) return; const node = cache.current.get(selectedId); if (!node) return;
    delete node.fx; delete node.fy; persist(); graph.current?.d3ReheatSimulation();
  };
  const reset = () => {
    cache.current.clear(); saved.current = {};
    try { localStorage.removeItem(positionKey(mode)); setStorageState("Đã đặt lại bố cục"); } catch { setStorageState("Không thể xóa bố cục đã lưu."); }
    if (layoutSaveTimer.current != null) window.clearTimeout(layoutSaveTimer.current);
    fetch(`/api/graph-layout?mode=${mode}`, { method: "DELETE" }).catch(() => setStorageState("Đã đặt lại trên thiết bị này; chưa đồng bộ lên tài khoản."));
    fitPending.current = true; setLayoutVersion(v => v + 1);
  };
  const changeMode = (value: GroupMode) => { setMode(value); setGroup("all"); setLocalRoot(null); };
  const changeGroup = (value: string) => { setGroup(value); setLocalRoot(null); };

  const drawNode = useCallback((node: SimulationNode, ctx: CanvasRenderingContext2D, scale: number) => paintNode(node, ctx, scale, theme, activeId, neighbors), [theme, activeId, neighbors]);
  const drawBackdrop = useCallback((ctx: CanvasRenderingContext2D) => paintClusters(ctx, theme, membersByGroup, neighbors), [theme, membersByGroup, neighbors]);
  const drawLabels = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    paintLabels(ctx, scale, { theme, nodes: graphData.nodes, groups, members: membersByGroup, activeId, neighbors, hoveredEdge: hoveredRelation, nodeMap: cache.current });
  }, [theme, graphData, groups, membersByGroup, activeId, neighbors, hoveredRelation]);

  const renderNodeButton = (node: MapNode) => {
    const Icon = iconFor(node.kind);
    return <button key={node.id} className={`km-node-row ${selectedId === node.id ? "is-selected" : ""}`} onClick={() => selectNode(node.id)} title={node.label} aria-pressed={selectedId === node.id}><Icon size={14} style={{ color: nodeTone(node.color, theme) }} /><span>{node.label}</span><small>{node.degree}</small></button>;
  };

  return <section ref={shell} tabIndex={-1} data-theme={theme} className={`km-shell ${fullscreen ? "km-fullscreen" : ""} ${libraryVisible ? "" : "km-library-collapsed"}`} role={fullscreen ? "dialog" : "region"} aria-modal={fullscreen || undefined} aria-label="Bản đồ tri thức">
    <header className="km-header"><div className="km-heading"><button className="km-library-toggle" onClick={() => setLibraryVisible(value => !value)} aria-expanded={libraryVisible} aria-label={libraryVisible ? "Thu gọn danh mục" : "Mở danh mục"}><PanelLeft size={17} /></button><span className="km-brand"><Network size={19} /></span><div><h1>Không gian tri thức</h1><p>{model.nodes.length} mục · {model.edges.length} liên kết · {model.nodes.filter(node => !node.degree).length} mục rời</p></div></div><div className="km-header-actions"><div className="km-theme-switch" role="group" aria-label="Màu nền bản đồ"><button aria-label="Nền tối Obsidian" aria-pressed={theme === "dark"} onClick={() => changeTheme("dark")}><Moon size={14} /><span>Tối</span></button><button aria-label="Nền sáng" aria-pressed={theme === "light"} onClick={() => changeTheme("light")}><Sun size={14} /><span>Sáng</span></button></div><button className="km-secondary" onClick={() => setFullscreen(v => !v)} aria-label={fullscreen ? "Thu gọn bản đồ" : "Mở rộng bản đồ"}>{fullscreen ? <Minimize2 size={16} /> : <Expand size={16} />}<span>{fullscreen ? "Thu gọn" : "Mở rộng"}</span></button><button className="km-primary" onClick={() => { setFullscreen(false); onCreate(); }}><Plus size={16} /> Ghi chú mới</button></div></header>
    <div className="km-toolbar"><button className="km-mobile-library km-secondary" aria-expanded={sidebar} onClick={() => setSidebar(v => !v)}><Folder size={15} /> Kho tri thức</button><div className="km-kind-filter" aria-label="Loại nội dung">{([['all','Tất cả'],['note','Ghi chú'],['task','Công việc'],['project','Dự án']] as const).map(([id, label]) => <button key={id} aria-pressed={kind === id} className={kind === id ? "is-active" : ""} onClick={() => setKind(id)}>{label}</button>)}</div><label className="km-group-select"><SlidersHorizontal size={14} /><span>Bố cục</span><select aria-label="Gom nhóm bản đồ" value={arrangement === "natural" ? "natural" : mode} onChange={e => { setArrangement(e.target.value === "natural" ? "natural" : "cluster"); if (e.target.value !== "natural") changeMode(e.target.value as GroupMode); fitPending.current = true; }}><option value="natural">Tự nhiên</option><option value="project">Theo dự án</option><option value="topic">Theo chủ đề</option></select></label></div>
    <div className="km-workspace">
      <aside className={`km-library ${sidebar ? "is-open" : ""}`} aria-label="Danh mục tri thức"><div className="km-library-title"><span>KHO TRI THỨC</span><button className="km-library-close" onClick={() => setSidebar(false)} aria-label="Đóng kho tri thức"><X size={16} /></button></div><label className="km-search"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm tên, chủ đề…" aria-label="Tìm trong kho tri thức" />{search && <button onClick={() => setSearch("")} aria-label="Xóa tìm kiếm"><X size={13} /></button>}</label>
        <div className="km-library-scroll">{search.trim() ? <><p className="km-library-caption">{searchResults.length}{searchResults.length === 60 ? "+" : ""} kết quả</p>{searchResults.map(renderNodeButton)}{!searchResults.length && <p className="km-library-empty">Không tìm thấy nội dung phù hợp.</p>}</> : <><button className={`km-all ${group === "all" ? "is-active" : ""}`} onClick={() => changeGroup("all")}><Network size={15} /><span>Toàn bộ bản đồ</span><small>{model.nodes.length}</small></button>{model.groups.map(g => <div key={g.id} className="km-folder"><div className="km-folder-row"><button className="km-chevron" aria-label={`${expanded.has(g.id) ? "Thu gọn" : "Mở"} nhóm ${g.label}`} aria-expanded={expanded.has(g.id)} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(g.id)) next.delete(g.id); else next.add(g.id); return next; })}>{expanded.has(g.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button><button className={group === g.id ? "is-active" : ""} onClick={() => changeGroup(g.id)} aria-pressed={group === g.id}><i style={{ background: nodeTone(g.color, theme) }} /><span>{g.label}</span><small>{g.count}</small></button></div>{expanded.has(g.id) && <div className="km-folder-children">{model.nodes.filter(n => n.group === g.id).slice(0, 100).map(renderNodeButton)}{g.count > 100 && <button className="km-show-more" onClick={() => { changeGroup(g.id); setSearch(g.label); }}>Tìm trong nhóm ({g.count})</button>}</div>}</div>)}</>}</div>
        <div className="km-library-foot"><label><input type="checkbox" checked={showOrphans} onChange={e => setShowOrphans(e.target.checked)} /> Hiện mục chưa có liên kết</label><p>Nhóm giúp bố trí. Đường nối là quan hệ đã lưu.</p></div>
      </aside>
      <div className="km-map-column"><div ref={surface} className="km-canvas" role="group" aria-label="Bản đồ tương tác; dùng danh mục để chọn nội dung bằng bàn phím">
        {view.nodes.length > 0 && size.width > 0 && <ForceGraph ref={attachGraph} width={size.width} height={size.height} graphData={graphData} backgroundColor={graphStyle[theme].background} minZoom={.08} maxZoom={8} nodeCanvasObject={drawNode} nodePointerAreaPaint={(raw, color, ctx) => { const n = raw as SimulationNode; ctx.beginPath(); ctx.arc(n.x || 0, n.y || 0, 10, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }} nodeLabel="" linkLabel="" linkColor={raw => { const e = raw as RenderEdge, highlighted = e.id === hoverEdge || e.id === selectedEdgeId || !!activeId && (endpoint(e.source) === activeId || endpoint(e.target) === activeId); return highlighted ? graphStyle[theme].edgeActive : neighbors ? graphStyle[theme].edgeDim : graphStyle[theme].edge; }} linkWidth={raw => (raw as RenderEdge).id === hoverEdge || (raw as RenderEdge).id === selectedEdgeId ? 1.5 : .65} linkDirectionalArrowLength={raw => ((raw as RenderEdge).id === hoverEdge || (raw as RenderEdge).id === selectedEdgeId) && (raw as RenderEdge).relationType !== "relates_to" ? 4 : 0} linkDirectionalArrowRelPos={.8} linkHoverPrecision={5} warmupTicks={reduceMotion.current ? 100 : 50} cooldownTicks={reduceMotion.current ? 0 : 100} d3AlphaDecay={.035} d3VelocityDecay={.4} onEngineStop={settle} onRenderFramePre={drawBackdrop} onRenderFramePost={drawLabels} enableNodeDrag onNodeDragEnd={raw => dragEnd(raw as SimulationNode)} onNodeClick={raw => { setSelectedEdgeId(null); selectNode((raw as SimulationNode).id, false); }} onNodeHover={raw => { setHoverId(raw ? (raw as SimulationNode).id : null); if (raw) setHoverEdge(null); }} onLinkHover={raw => { setHoverEdge(raw ? (raw as RenderEdge).id : null); if (raw) setHoverId(null); }} onLinkClick={raw => { const edge = raw as RenderEdge; setSelectedEdgeId(edge.id); setSelectedId(null); setHoverId(null); setHoverEdge(null); }} onBackgroundClick={() => { setSelectedId(null); setSelectedEdgeId(null); setHoverId(null); setHoverEdge(null); }} onZoom={transform => setZoom(transform.k)} />}
        {!view.nodes.length && <div className="km-empty"><Network size={36} /><h2>{model.nodes.length ? "Chưa có mục phù hợp" : "Bắt đầu bản đồ của anh"}</h2><p>{model.nodes.length ? "Thử đổi bộ lọc hoặc hiện các mục chưa có liên kết." : "Tạo ghi chú và liên kết với công việc, dự án để xây kho tri thức."}</p><button className="km-secondary" onClick={() => { setKind("all"); setGroup("all"); setLocalRoot(null); setShowOrphans(true); if (!model.nodes.length) { setFullscreen(false); onCreate(); } }}>{model.nodes.length ? "Hiện toàn bộ" : "Tạo ghi chú"}</button></div>}
        <div className="km-map-status"><i />{view.nodes.length} mục · {view.edges.length} liên kết{group !== "all" && <button aria-label="Bỏ lọc nhóm" onClick={() => changeGroup("all")}><X size={13} /></button>}</div>
        {localRoot && <div className="km-local-bar"><span>Quanh: {tooltipText(model.nodeMap.get(localRoot)?.label || "", 25)}</span><select aria-label="Độ sâu liên kết" value={depth} onChange={e => setDepth(Number(e.target.value))}><option value={1}>1 bậc</option><option value={2}>2 bậc</option></select><button aria-label="Thoát bản đồ cục bộ" onClick={() => setLocalRoot(null)}><X size={14} /></button></div>}
        {(hoverId || hoveredRelation) && <div className="km-hover-card">{hoverId ? model.nodeMap.get(hoverId)?.label : `${model.nodeMap.get(hoveredRelation!.source)?.label} → ${relationLabel[hoveredRelation!.relationType] || hoveredRelation!.relationType} → ${model.nodeMap.get(hoveredRelation!.target)?.label}`}</div>}
        {selectedRelation && <aside className="km-edge-card" aria-live="polite"><header><span>CHI TIẾT LIÊN KẾT</span><button onClick={() => setSelectedEdgeId(null)} aria-label="Đóng chi tiết liên kết"><X size={15} /></button></header><p><strong>{model.nodeMap.get(selectedRelation.source)?.label}</strong><span> → {relationLabel[selectedRelation.relationType] || selectedRelation.relationType} → </span><strong>{model.nodeMap.get(selectedRelation.target)?.label}</strong></p>{selectedRelation.sourceInput ? <div className="km-edge-evidence"><small>ĐẦU VÀO GHI NHẬN · {selectedRelation.sourceLabel || "Flowdesk"}{selectedRelation.sourceCapturedAt ? ` · ${new Date(selectedRelation.sourceCapturedAt).toLocaleDateString("vi-VN")}` : ""}</small><blockquote>{tooltipText(selectedRelation.sourceInput, 280)}</blockquote></div> : <p className="km-edge-unverified">Chưa lưu đầu vào làm căn cứ cho liên kết này.</p>}</aside>}
        <div className="km-zoom"><button aria-label="Phóng to bản đồ" onClick={() => graph.current?.zoom(Math.min(8, zoom * 1.3), reduceMotion.current ? 0 : 220)}><Plus size={17} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Thu nhỏ bản đồ" onClick={() => graph.current?.zoom(Math.max(.08, zoom / 1.3), reduceMotion.current ? 0 : 220)}><Minus size={17} /></button><hr /><button aria-label="Thu vừa bản đồ" title="Thu vừa bản đồ" onClick={fit}><LocateFixed size={17} /></button><button aria-label="Đặt lại vị trí đã ghim" title="Đặt lại vị trí đã ghim" onClick={reset}><RotateCcw size={16} /></button></div>
        <div className="km-canvas-hint">Kéo mục để ghim vị trí · Kéo nền để di chuyển · Cuộn để thu/phóng</div>
      </div><footer className="km-footer"><span><i className="km-legend-project" />Dự án</span><span><i className="km-legend-task" />Công việc</span><span><i className="km-legend-note" />Ghi chú</span><p role="status">{storageState || "Vị trí ghim được lưu trên thiết bị này"}</p></footer></div>
      {selected && <aside className="km-detail" aria-label="Chi tiết mục đã chọn"><header><span>{kindLabel[selected.kind]}</span><button onClick={() => setSelectedId(null)} aria-label="Đóng chi tiết"><X size={17} /></button></header><div className="km-detail-body"><span className="km-detail-group" style={{ color: nodeTone(selected.color, theme) }}>{selected.groupLabel}</span><h2>{selected.label}</h2><p className="km-detail-meta">{selected.meta} · {selected.degree} liên kết</p>{!visibleIds.has(selected.id) && <p className="km-detail-warning">Mục này đang nằm ngoài bộ lọc. <button onClick={() => selectNode(selected.id)}>Hiện trên bản đồ</button></p>}<p className="km-excerpt">{selected.body ? tooltipText(selected.body, 900) : "Chưa có nội dung chi tiết."}</p><button className="km-primary km-open" onClick={() => { setFullscreen(false); onOpen(selected); }}>Mở và chỉnh sửa</button><div className="km-detail-actions"><button className="km-secondary" onClick={() => { setLocalRoot(selected.id); setDepth(1); setKind("all"); setGroup("all"); setShowOrphans(true); }}><Compass size={14} /> Quanh mục này</button>{cache.current.get(selected.id)?.fx != null && <button className="km-secondary" onClick={unpin}><PinOff size={14} /> Bỏ ghim</button>}</div><h3>LIÊN KẾT <span>{selectedEdges.length}</span></h3>{selectedEdges.length ? selectedEdges.map(edge => { const outgoing = edge.source === selected.id; const other = model.nodeMap.get(outgoing ? edge.target : edge.source)!; const Icon = iconFor(other.kind); return <button key={edge.id} className="km-relation" onClick={() => selectNode(other.id)}><Icon size={15} style={{ color: nodeTone(other.color, theme) }} /><span><small>{edge.relationType === "relates_to" ? "↔" : outgoing ? "→" : "←"} {relationLabel[edge.relationType] || edge.relationType}</small><strong>{other.label}</strong></span><ChevronRight size={14} /></button>; }) : <p className="km-library-empty">Chưa có quan hệ. Mở chỉnh sửa để gắn dự án hoặc liên kết ghi chú.</p>}</div></aside>}
    </div>
  </section>;
}
