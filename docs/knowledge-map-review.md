# Knowledge map — October 15, 2026

## Visual refinement after v61

- Default charcoal theme inspired by Obsidian, plus warm light mode. Theme preference is saved in the browser; changing it does not reset node positions.
- Canvas occupies the viewport with reduced outer margins and compact toolbar. Library can collapse on desktop. Detail is an overlay, so selecting a node no longer changes canvas width.
- Glyph outlines replace rectangular label backgrounds. Screen-space node sizes are capped across zoom levels; sparse maps expose readable labels and auto-fit has a zoom ceiling.
- Pastel group colors, restrained active-node halo, thin edges and very subtle cluster atmosphere. No visual-only relations are added.
- Irregular phyllotaxis seeding replaces a rigid grid/ring. Default natural layout uses weak group attraction and normal link lengths; project/topic layouts offer stronger clustering.
- Canvas clicks select without automatically zooming. Library selections pan to a record; changing selection does not trigger auto-fit.
- `scripts/check-graph-paint.cjs` covers node sizing across five zooms, sparse labeling, absence of rectangular label cards, camera limits, theme controls and text contrast in both themes.
- Optional `--render-dir` raster checks run the actual Canvas renderer and force engine using synthetic fixtures (12 and 400 notes). The four rendered theme/density combinations were inspected; font rendering was corrected to standard numeric weights and system UI fallbacks. This verifies the renderer, not browser CSS or touch behavior. Optional native raster diagnostics require an installed `@napi-rs/canvas`; production does not depend on it.

## Shipped scope

- Knowledge is now a dedicated, wide workspace: graph first, collapsible lookup/import/export and note cards below it.
- Warm canvas, compact colored nodes, thin subdued edges; hexagon projects, square tasks, circle notes. Unlinked records are outlined.
- Library groups by saved project membership, or note topic. Counts reflect actual records. Grouping affects layout only, never inserts semantic links.
- Soft cluster attraction and grid collision use the existing react-force-graph-2d Canvas engine. Explicit ResizeObserver sizing replaces window-sized canvas defaults.
- Collision-aware labels: selected and hovered records first; group labels at overview scale; more node labels when zoomed in. Hover a relationship to show its label and direction.
- Search library (Vietnamese diacritics insensitive), filter type/group/orphans, traverse one or two hops, select a related record from the detail panel.
- Detail panel shows current degree from validated relationships; incoming/outgoing relations and content preview; opens existing editors.
- Drag to pin. Pins restore from browser localStorage, separately for project/topic layouts. Unpin and reset controls are available. They are not synced between devices.
- Node simulation objects survive selection/hover/filter updates. Memoized workspace arrays prevent unrelated parent renders from rebuilding graph data.
- Fullscreen workspace, keyboard focus controls, accessible library alternative, mobile library drawer and detail bottom sheet. CSS honors safe areas; reduced-motion uses immediate camera movement.
- Deleted/rejected/expired/dangling/self relationships are excluded; symmetric relates_to duplicates are coalesced. Original workspace records remain untouched.

## Validation

- `node scripts/check-knowledge-map.cjs`: 21 checks covering relationship integrity, degrees, grouping, one/two-hop traversal, type filters, orphan handling, saved pins, node identity, immutable input, a synthetic 1,000-node graph and server-rendered controls.
- TypeScript and production build.
- Task planning and daily quote checks run as regression checks after the root page integration.
- Browser QA is unavailable: the managed environment has no control-browser skill. No preview server was started. Canvas appearance, pointer/touch feel, fullscreen, keyboard focus and Android behavior require a real browser verification; synthetic tests are not a performance benchmark.

## Boundaries

- Only source records and saved relationships are drawn; there are no invented nodes, automatic semantic assertions or background LLM calls.
- Groups are project/topic metadata, not algorithmically discovered communities.
- This is an adaptation based on the supplied Javis screenshot; its implementation and runtime behavior were not inspected.
- The server schema and task/Telegram/Calendar behavior are unchanged.
