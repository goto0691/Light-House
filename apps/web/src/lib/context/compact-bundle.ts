import type { ContextBundle, ContextEdge, ContextLensKey, ContextNode } from "@/lib/context/types";

const GROUP_KEYS = ["people", "projects", "zettels", "media", "dates", "places", "source", "unresolved"] as const;
const LENS_KEYS: ContextLensKey[] = ["overview", "people", "projects", "zettels", "media", "dates", "places", "source", "unresolved"];

type CompactOptions = {
  edgeLimit?: number;
  evidenceLimit?: number;
  nodePreviewLength?: number;
  snippetLength?: number;
};

const EMPTY_GROUPED: ContextBundle["grouped"] = {
  people: [],
  projects: [],
  zettels: [],
  media: [],
  dates: [],
  places: [],
  source: [],
  unresolved: [],
};

function nodeKey(node: Pick<ContextNode, "id" | "type">) {
  return `${node.type}:${node.id}`;
}

function edgeKey(edge: ContextEdge) {
  return `${edge.from.type}:${edge.from.id}->${edge.to.type}:${edge.to.id}:${edge.label}`;
}

function trimText(value: string | undefined, maxLength: number) {
  if (!value || maxLength <= 0) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function compactNode(node: ContextNode, previewLength: number): ContextNode {
  return {
    type: node.type,
    id: node.id,
    title: trimText(node.title, 160) ?? node.title,
    href: node.href,
    subtitle: trimText(node.subtitle, 120),
    preview: trimText(node.preview, previewLength),
    icon: node.icon,
    tone: node.tone,
    sourceDocumentId: node.sourceDocumentId,
    disambiguationLabel: trimText(node.disambiguationLabel, 120),
  };
}

function compactEdge(edge: ContextEdge, evidenceLimit: number, snippetLength: number): ContextEdge {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    label: edge.label,
    kind: edge.kind,
    confidence: edge.confidence,
    createdAt: edge.createdAt,
    evidence: evidenceLimit > 0
      ? edge.evidence.slice(0, evidenceLimit).map((item) => ({
          source: item.source,
          table: item.table,
          sourceDocumentId: item.sourceDocumentId,
          propertyName: trimText(item.propertyName, 80),
          snippet: trimText(item.snippet, snippetLength),
        }))
      : [],
  };
}

function uniqueNodes(nodes: ContextNode[]) {
  const map = new Map<string, ContextNode>();
  for (const node of nodes) {
    map.set(nodeKey(node), node);
  }
  return [...map.values()];
}

function uniqueEdges(edges: ContextEdge[]) {
  const map = new Map<string, ContextEdge>();
  for (const edge of edges) {
    map.set(edgeKey(edge), edge);
  }
  return [...map.values()];
}

function compactNodeList(nodes: ContextNode[], previewLength: number) {
  return uniqueNodes(nodes).map((node) => compactNode(node, previewLength));
}

function compactPages(bundle: ContextBundle, previewLength: number) {
  const pages: NonNullable<ContextBundle["pages"]> = {};
  for (const lens of LENS_KEYS) {
    const nodes = bundle.pages?.[lens];
    if (nodes) pages[lens] = compactNodeList(nodes, previewLength);
  }
  return pages;
}

function compactGrouped(bundle: ContextBundle, previewLength: number) {
  const grouped: ContextBundle["grouped"] = { ...EMPTY_GROUPED };
  for (const key of GROUP_KEYS) {
    grouped[key] = compactNodeList(bundle.grouped[key], previewLength);
  }
  return grouped;
}

function collectInitialNodes(bundle: ContextBundle) {
  const pageNodes = LENS_KEYS.flatMap((lens) => bundle.pages?.[lens] ?? []);
  const groupedNodes = GROUP_KEYS.flatMap((key) => bundle.grouped[key]);
  const timelineNodes = bundle.timeline.flatMap((item) => item.nodes);
  const mapNodes = bundle.nodes.filter((node) => nodeKey(node) !== nodeKey(bundle.focus)).slice(0, 10);
  return uniqueNodes([bundle.focus, ...pageNodes, ...groupedNodes, ...timelineNodes, ...mapNodes]);
}

function compactEdgesForNodes(bundle: ContextBundle, nodes: ContextNode[], options: Required<CompactOptions>) {
  const nodeKeys = new Set(nodes.map(nodeKey));
  const visibleEdges = bundle.edges.filter((edge) => nodeKeys.has(`${edge.from.type}:${edge.from.id}`) || nodeKeys.has(`${edge.to.type}:${edge.to.id}`));
  const seedEdges = visibleEdges.length ? visibleEdges : bundle.edges;
  return uniqueEdges(seedEdges)
    .slice(0, options.edgeLimit)
    .map((edge) => compactEdge(edge, options.evidenceLimit, options.snippetLength));
}

export function compactContextBundleForPage(bundle: ContextBundle, options: CompactOptions = {}): ContextBundle {
  const resolved = {
    edgeLimit: options.edgeLimit ?? 72,
    evidenceLimit: options.evidenceLimit ?? 1,
    nodePreviewLength: options.nodePreviewLength ?? 160,
    snippetLength: options.snippetLength ?? 140,
  };
  const nodes = collectInitialNodes(bundle);
  const compactNodes = compactNodeList(nodes, resolved.nodePreviewLength);

  return {
    focus: compactNode(bundle.focus, 240),
    nodes: compactNodes,
    edges: compactEdgesForNodes(bundle, nodes, resolved),
    summary: {
      nodeCount: bundle.nodes.length,
      edgeCount: bundle.edges.length,
    },
    pages: compactPages(bundle, resolved.nodePreviewLength),
    pagination: bundle.pagination,
    grouped: compactGrouped(bundle, resolved.nodePreviewLength),
    timeline: bundle.timeline.slice(0, 12).map((item) => ({
      date: item.date,
      nodes: compactNodeList(item.nodes, resolved.nodePreviewLength),
      edges: [],
    })),
    quality: bundle.quality,
  };
}

export function compactContextBundleForMini(bundle: ContextBundle): ContextBundle {
  const focusKey = nodeKey(bundle.focus);
  const nodes = uniqueNodes([bundle.focus, ...bundle.nodes.filter((node) => nodeKey(node) !== focusKey).slice(0, 10)]);
  const visibleKeys = new Set(nodes.map(nodeKey));
  const edges = bundle.edges
    .filter((edge) => visibleKeys.has(`${edge.from.type}:${edge.from.id}`) && visibleKeys.has(`${edge.to.type}:${edge.to.id}`))
    .slice(0, 18)
    .map((edge) => compactEdge(edge, 0, 0));

  return {
    focus: compactNode(bundle.focus, 0),
    nodes: compactNodeList(nodes.filter((node) => nodeKey(node) !== focusKey), 0),
    edges,
    summary: {
      nodeCount: bundle.nodes.length,
      edgeCount: bundle.edges.length,
    },
    grouped: { ...EMPTY_GROUPED },
    timeline: [],
    quality: bundle.quality,
  };
}
