import type { DimensionKey } from "@/lib/mock-data";
import type { EditableSummary } from "@/lib/store";

export type Connector = {
  id: string;
  summaryId: string;
  key: DimensionKey;
  color: string;
  path: string;
  startX: number;
  startY: number;
};

type ConnectorOverlayProps = {
  connectors: Connector[];
  canvasSize: { width: number; height: number };
  activeSummaryId?: string | null;
  summaries: EditableSummary[];
};

export function ConnectorOverlay({
  connectors,
  canvasSize,
  activeSummaryId,
  summaries,
}: ConnectorOverlayProps) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 overflow-visible"
      width={canvasSize.width}
      height={canvasSize.height}
      aria-hidden="true"
    >
      <defs>
        {connectors.map((connector) => (
          <marker
            key={connector.id}
            id={`arrow-${connector.id}`}
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 Z" fill={connector.color} />
          </marker>
        ))}
      </defs>
      {connectors.map((connector) => {
        const selected = activeSummaryId === connector.summaryId;
        const excluded =
          summaries.find((item) => item.id === connector.summaryId)?.status ===
          "excluded";
        return (
          <g key={connector.id} opacity={excluded ? 0.2 : selected ? 1 : 0.5}>
            <circle
              cx={connector.startX}
              cy={connector.startY}
              r={selected ? 4 : 3}
              fill={connector.color}
              stroke="white"
              strokeWidth="2"
            />
            <path
              d={connector.path}
              fill="none"
              stroke={connector.color}
              strokeWidth={selected ? 2.5 : 1.5}
              strokeDasharray={excluded ? "2 5" : selected ? undefined : "4 3"}
              markerEnd={`url(#arrow-${connector.id})`}
            />
          </g>
        );
      })}
    </svg>
  );
}
