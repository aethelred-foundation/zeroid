"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Brain,
  Cpu,
  ZoomIn,
  ZoomOut,
  Maximize2,
  X,
  Shield,
  Clock,
  ChevronRight,
  Loader2,
  AlertTriangle,
  User,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

type AgentNodeType = "llm" | "autonomous" | "bot" | "human";
type AgentNodeStatus = "active" | "suspended" | "inactive" | "expired";

interface DelegationCapability {
  id: string;
  label: string;
}

interface AgentNode {
  id: string;
  name: string;
  did: string;
  type: AgentNodeType;
  status: AgentNodeStatus;
  depth: number;
  parentId?: string;
  capabilities: DelegationCapability[];
  delegatedAt: number;
  expiresAt?: number;
}

interface DelegationEdge {
  from: string;
  to: string;
  capabilities: string[];
  active: boolean;
  delegatedAt: number;
  expiresAt?: number;
}

interface AgentDelegationGraphProps {
  nodes?: AgentNode[];
  edges?: DelegationEdge[];
  loading?: boolean;
  error?: string | null;
  onNodeClick?: (node: AgentNode) => void;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const NODE_TYPE_CONFIG: Record<
  AgentNodeType,
  { icon: typeof Bot; color: string; bg: string; border: string }
> = {
  human: {
    icon: User,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  llm: {
    icon: Brain,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
  },
  autonomous: {
    icon: Cpu,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/30",
  },
  bot: {
    icon: Bot,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
};

const STATUS_COLORS: Record<AgentNodeStatus, string> = {
  active: "bg-emerald-400",
  suspended: "bg-red-400",
  inactive: "bg-zero-400",
  expired: "bg-zero-600",
};

const DEPTH_COLORS = [
  "from-blue-500/20 to-blue-600/20",
  "from-violet-500/20 to-violet-600/20",
  "from-cyan-500/20 to-cyan-600/20",
  "from-amber-500/20 to-amber-600/20",
  "from-emerald-500/20 to-emerald-600/20",
];

// ============================================================================
// Mock data generator
// ============================================================================

function generateMockGraph(): { nodes: AgentNode[]; edges: DelegationEdge[] } {
  const nodes: AgentNode[] = [
    {
      id: "root",
      name: "Treasury Admin",
      did: "did:aethelred:mainnet:0xabc123",
      type: "human",
      status: "active",
      depth: 0,
      capabilities: [{ id: "all", label: "Full Access" }],
      delegatedAt: Date.now() - 30 * 86400000,
    },
    {
      id: "agent-1",
      name: "Compliance Engine",
      did: "did:aethelred:mainnet:0xdef456",
      type: "llm",
      status: "active",
      depth: 1,
      parentId: "root",
      capabilities: [
        { id: "screen", label: "Screening" },
        { id: "report", label: "Reporting" },
      ],
      delegatedAt: Date.now() - 20 * 86400000,
      expiresAt: Date.now() + 60 * 86400000,
    },
    {
      id: "agent-2",
      name: "Transaction Monitor",
      did: "did:aethelred:mainnet:0xghi789",
      type: "autonomous",
      status: "active",
      depth: 1,
      parentId: "root",
      capabilities: [
        { id: "monitor", label: "Monitoring" },
        { id: "alert", label: "Alerting" },
      ],
      delegatedAt: Date.now() - 15 * 86400000,
    },
    {
      id: "agent-3",
      name: "KYC Bot",
      did: "did:aethelred:mainnet:0xjkl012",
      type: "bot",
      status: "active",
      depth: 2,
      parentId: "agent-1",
      capabilities: [{ id: "kyc", label: "KYC Check" }],
      delegatedAt: Date.now() - 10 * 86400000,
    },
    {
      id: "agent-4",
      name: "Sanctions Screener",
      did: "did:aethelred:mainnet:0xmno345",
      type: "bot",
      status: "active",
      depth: 2,
      parentId: "agent-1",
      capabilities: [{ id: "sanctions", label: "Sanctions" }],
      delegatedAt: Date.now() - 8 * 86400000,
    },
    {
      id: "agent-5",
      name: "Report Generator",
      did: "did:aethelred:mainnet:0xpqr678",
      type: "llm",
      status: "suspended",
      depth: 2,
      parentId: "agent-2",
      capabilities: [{ id: "report", label: "Report Gen" }],
      delegatedAt: Date.now() - 5 * 86400000,
    },
    {
      id: "agent-6",
      name: "Data Aggregator",
      did: "did:aethelred:mainnet:0xstu901",
      type: "autonomous",
      status: "expired",
      depth: 3,
      parentId: "agent-3",
      capabilities: [{ id: "data", label: "Data Access" }],
      delegatedAt: Date.now() - 60 * 86400000,
      expiresAt: Date.now() - 2 * 86400000,
    },
  ];

  const edges: DelegationEdge[] = nodes
    .filter((n) => n.parentId)
    .map((n) => ({
      from: n.parentId!,
      to: n.id,
      capabilities: n.capabilities.map((c) => c.label),
      active: n.status === "active",
      delegatedAt: n.delegatedAt,
      expiresAt: n.expiresAt,
    }));

  return { nodes, edges };
}

// ============================================================================
// Layout
// ============================================================================

interface LayoutNode extends AgentNode {
  x: number;
  y: number;
}

function computeLayout(nodes: AgentNode[]): LayoutNode[] {
  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  const levelCounts: Record<number, number> = {};
  const levelIndex: Record<number, number> = {};

  for (const node of nodes) {
    levelCounts[node.depth] = (levelCounts[node.depth] ?? 0) + 1;
    levelIndex[node.depth] = 0;
  }

  return nodes.map((node) => {
    const count = levelCounts[node.depth];
    const idx = levelIndex[node.depth]++;
    const xSpan = 800;
    const ySpan = 500;
    const x =
      count === 1 ? xSpan / 2 : (idx / (count - 1)) * (xSpan - 160) + 80;
    const y =
      maxDepth === 0
        ? ySpan / 2
        : (node.depth / Math.max(maxDepth, 1)) * (ySpan - 120) + 60;
    return { ...node, x, y };
  });
}

// ============================================================================
// Sub-components
// ============================================================================

function GraphNode({
  node,
  selected,
  highlighted,
  onClick,
}: {
  node: LayoutNode;
  selected: boolean;
  highlighted: boolean;
  onClick: () => void;
}) {
  const config = NODE_TYPE_CONFIG[node.type];
  const NodeIcon = config.icon;
  const depthColor = DEPTH_COLORS[node.depth % DEPTH_COLORS.length];

  return (
    <motion.g
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: highlighted || !selected ? 1 : 0.3, scale: 1 }}
      transition={{ duration: 0.4, delay: node.depth * 0.1 }}
      onClick={onClick}
      className="cursor-pointer"
    >
      {/* Node background */}
      <foreignObject x={node.x - 60} y={node.y - 30} width={120} height={72}>
        <motion.div
          className={`w-full h-full rounded-xl bg-gradient-to-br ${depthColor} border ${
            selected && highlighted
              ? "border-brand-500 ring-2 ring-brand-500/30"
              : config.border
          } p-2 flex flex-col items-center justify-center transition-colors hover:border-brand-500/50`}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <NodeIcon className={`w-3.5 h-3.5 ${config.color}`} />
            <span className="text-[10px] font-semibold text-[var(--text-primary)] truncate max-w-[70px]">
              {node.name}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[node.status]}`}
            />
            <span className="text-[8px] text-[var(--text-tertiary)] capitalize">
              {node.status}
            </span>
          </div>
        </motion.div>
      </foreignObject>
    </motion.g>
  );
}

function GraphEdge({
  from,
  to,
  edge,
  highlighted,
}: {
  from: LayoutNode;
  to: LayoutNode;
  edge: DelegationEdge;
  highlighted: boolean;
}) {
  const midY = (from.y + to.y) / 2;
  const path = `M ${from.x} ${from.y + 30} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y - 30}`;

  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={{ opacity: highlighted ? 1 : 0.2 }}
      transition={{ duration: 0.3 }}
    >
      <path
        d={path}
        fill="none"
        stroke={edge.active ? "rgb(14, 165, 233)" : "rgb(100, 116, 139)"}
        strokeWidth={highlighted ? 2.5 : 1.5}
        strokeDasharray={edge.active ? "none" : "6 4"}
        className="transition-all"
      />
      {/* Capability label on edge */}
      {edge.capabilities.length > 0 && highlighted && (
        <foreignObject
          x={(from.x + to.x) / 2 - 40}
          y={midY - 10}
          width={80}
          height={20}
        >
          <div className="flex items-center justify-center">
            <span className="px-2 py-0.5 rounded text-[8px] bg-[var(--surface-elevated)] border border-[var(--border-primary)] text-[var(--text-tertiary)] truncate max-w-[76px]">
              {edge.capabilities.join(", ")}
            </span>
          </div>
        </foreignObject>
      )}
    </motion.g>
  );
}

function DetailPanel({
  node,
  onClose,
}: {
  node: AgentNode;
  onClose: () => void;
}) {
  const config = NODE_TYPE_CONFIG[node.type];
  const NodeIcon = config.icon;

  return (
    <motion.div
      className="absolute right-4 top-4 w-72 rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-elevated)] shadow-2xl z-20 overflow-hidden"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.25 }}
    >
      <div className="flex items-center justify-between p-4 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center`}
          >
            <NodeIcon className={`w-4 h-4 ${config.color}`} />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">
              {node.name}
            </h4>
            <span className="text-[10px] text-[var(--text-tertiary)] capitalize">
              {node.type}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors"
        >
          <X className="w-4 h-4 text-[var(--text-tertiary)]" />
        </button>
      </div>

      <div className="p-4 space-y-3">
        <div className="p-2.5 rounded-lg bg-[var(--surface-secondary)]">
          <p className="text-[10px] text-[var(--text-tertiary)] mb-0.5">DID</p>
          <p className="text-xs font-mono text-[var(--text-primary)] break-all">
            {node.did}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-lg bg-[var(--surface-secondary)]">
            <p className="text-[10px] text-[var(--text-tertiary)] mb-0.5">
              Status
            </p>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${STATUS_COLORS[node.status]}`}
              />
              <span className="text-xs text-[var(--text-primary)] capitalize">
                {node.status}
              </span>
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--surface-secondary)]">
            <p className="text-[10px] text-[var(--text-tertiary)] mb-0.5">
              Depth
            </p>
            <p className="text-xs text-[var(--text-primary)]">
              Level {node.depth}
            </p>
          </div>
        </div>

        <div>
          <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mb-1.5">
            Capabilities
          </p>
          <div className="flex flex-wrap gap-1">
            {node.capabilities.map((cap) => (
              <span
                key={cap.id}
                className="px-2 py-0.5 rounded text-[10px] font-medium bg-brand-500/10 text-brand-500"
              >
                {cap.label}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-lg bg-[var(--surface-secondary)]">
            <p className="text-[10px] text-[var(--text-tertiary)] mb-0.5">
              Delegated
            </p>
            <p className="text-xs text-[var(--text-primary)]">
              {new Date(node.delegatedAt).toLocaleDateString()}
            </p>
          </div>
          {node.expiresAt && (
            <div className="p-2.5 rounded-lg bg-[var(--surface-secondary)]">
              <p className="text-[10px] text-[var(--text-tertiary)] mb-0.5">
                Expires
              </p>
              <p className="text-xs text-[var(--text-primary)]">
                {new Date(node.expiresAt).toLocaleDateString()}
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function AgentDelegationGraph({
  nodes: externalNodes,
  edges: externalEdges,
  loading = false,
  error = null,
  onNodeClick,
  className = "",
}: AgentDelegationGraphProps) {
  const mockData = useMemo(() => generateMockGraph(), []);
  const nodes = externalNodes ?? mockData.nodes;
  const edges = externalEdges ?? mockData.edges;

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const layoutNodes = useMemo(() => computeLayout(nodes), [nodes]);
  const nodeMap = useMemo(() => {
    const map = new Map<string, LayoutNode>();
    for (const n of layoutNodes) map.set(n.id, n);
    return map;
  }, [layoutNodes]);

  // Compute highlight path from root to selected
  const highlightedNodeIds = useMemo(() => {
    if (!selectedNodeId) return new Set(nodes.map((n) => n.id));
    const ids = new Set<string>();
    let current: string | undefined = selectedNodeId;
    while (current) {
      ids.add(current);
      const node = nodes.find((n) => n.id === current);
      current = node?.parentId;
    }
    // Also add children
    const addChildren = (parentId: string) => {
      for (const n of nodes) {
        if (n.parentId === parentId) {
          ids.add(n.id);
          addChildren(n.id);
        }
      }
    };
    addChildren(selectedNodeId);
    return ids;
  }, [selectedNodeId, nodes]);

  const highlightedEdgeKeys = useMemo(() => {
    return new Set(
      edges
        .filter(
          (e) => highlightedNodeIds.has(e.from) && highlightedNodeIds.has(e.to),
        )
        .map((e) => `${e.from}-${e.to}`),
    );
  }, [edges, highlightedNodeIds]);

  const selectedNode = useMemo(
    () =>
      selectedNodeId
        ? (nodes.find((n) => n.id === selectedNodeId) ?? null)
        : null,
    [selectedNodeId, nodes],
  );

  const handleNodeClick = useCallback(
    (node: AgentNode) => {
      setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
      onNodeClick?.(node);
    },
    [onNodeClick],
  );

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.2, 2));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.2, 0.4));
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setDragging(false);

  if (loading) {
    return (
      <div
        className={`card p-8 flex items-center justify-center gap-2 ${className}`}
      >
        <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
        <span className="text-sm text-[var(--text-secondary)]">
          Loading delegation graph...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`card p-6 border-red-500/30 ${className}`}>
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="w-5 h-5" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Agent Delegation Graph
          </h3>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            {nodes.length} agents
          </span>
        </div>
        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors"
          >
            <ZoomOut className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>
          <span className="text-[10px] text-[var(--text-tertiary)] w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors"
          >
            <ZoomIn className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>
          <button
            onClick={handleReset}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors"
          >
            <Maximize2 className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>
        </div>
      </div>

      {/* Graph area */}
      <div
        className="relative h-[450px] overflow-hidden"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: dragging ? "grabbing" : "grab" }}
      >
        <svg
          ref={svgRef}
          className="w-full h-full"
          viewBox="0 0 800 500"
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: "center center",
          }}
        >
          {/* Edges */}
          {edges.map((edge) => {
            const from = nodeMap.get(edge.from);
            const to = nodeMap.get(edge.to);
            if (!from || !to) return null;
            return (
              <GraphEdge
                key={`${edge.from}-${edge.to}`}
                from={from}
                to={to}
                edge={edge}
                highlighted={highlightedEdgeKeys.has(`${edge.from}-${edge.to}`)}
              />
            );
          })}

          {/* Nodes */}
          {layoutNodes.map((node) => (
            <GraphNode
              key={node.id}
              node={node}
              selected={!!selectedNodeId}
              highlighted={highlightedNodeIds.has(node.id)}
              onClick={() => handleNodeClick(node)}
            />
          ))}
        </svg>

        {/* Detail panel */}
        <AnimatePresence>
          {selectedNode && (
            <DetailPanel
              node={selectedNode}
              onClose={() => setSelectedNodeId(null)}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 px-5 py-3 border-t border-[var(--border-primary)]">
        {(
          Object.entries(NODE_TYPE_CONFIG) as [
            AgentNodeType,
            (typeof NODE_TYPE_CONFIG)[AgentNodeType],
          ][]
        ).map(([type, config]) => {
          const Icon = config.icon;
          return (
            <div key={type} className="flex items-center gap-1.5">
              <Icon className={`w-3 h-3 ${config.color}`} />
              <span className="text-[10px] text-[var(--text-tertiary)] capitalize">
                {type}
              </span>
            </div>
          );
        })}
        <div className="w-px h-3 bg-[var(--border-primary)]" />
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-0.5 bg-sky-500 rounded" />
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Active
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="w-6 h-0.5 bg-zero-500 rounded border-dashed"
            style={{ borderTop: "1.5px dashed rgb(100,116,139)" }}
          />
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Expired
          </span>
        </div>
      </div>
    </div>
  );
}
