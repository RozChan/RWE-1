export type DimensionKey = string;

export type TranscriptFragment = {
  text: string;
  annotationIds?: string[];
};

export type Transcript = {
  id: string;
  speaker: string;
  timestamp: string;
  fragments: TranscriptFragment[];
  originalText?: string | null;
  currentText?: string | null;
  isEdited?: boolean;
  isDeleted?: boolean;
  updatedAt?: string | null;
};

export type Summary = {
  id: string;
  key: DimensionKey;
  title: string;
  summary: string;
  confidence: number;
  evidenceId: string;
};

export type DimensionMeta = {
  color: string;
  soft: string;
  border: string;
  label: string;
};

export const dimensionPalette: DimensionMeta[] = [
  { color: "#3478f6", soft: "#eaf2ff", border: "#8db7ff", label: "核心观点" },
  { color: "#8b5cf6", soft: "#f1ebff", border: "#c4adff", label: "关键事实" },
  { color: "#16a980", soft: "#e6f8f2", border: "#72d4b8", label: "重要进展" },
  { color: "#f39a21", soft: "#fff4e2", border: "#ffc66f", label: "行动建议" },
  { color: "#ed5b72", soft: "#ffedf0", border: "#ff9cac", label: "风险问题" },
  { color: "#6d72df", soft: "#eeeeff", border: "#aeb1ff", label: "待确认事项" },
  { color: "#0891b2", soft: "#e6f8fc", border: "#67c9dc", label: "自定义维度" },
  { color: "#65a30d", soft: "#f1f8df", border: "#a8cf62", label: "自定义维度" },
  { color: "#db2777", soft: "#fce7f3", border: "#f58abb", label: "自定义维度" },
];

const defaultDimensionIndexes: Record<string, number> = {
  topic: 0,
  goal: 1,
  progress: 2,
  next: 3,
  highlight: 4,
  advice: 5,
};

export function getDimensionMeta(key: DimensionKey): DimensionMeta {
  const customIndex = /^custom_(\d+)$/.exec(key);
  const index = customIndex
    ? Number(customIndex[1])
    : (defaultDimensionIndexes[key] ?? 0);
  return dimensionPalette[index] ?? dimensionPalette[0];
}

export const dimensionMeta: Record<string, DimensionMeta> = new Proxy(
  {},
  { get: (_target, key) => getDimensionMeta(String(key)) },
);


export const transcripts: Transcript[] = [
  {
    id: "P1",
    speaker: "说话人 4",
    timestamp: "02:33",
    fragments: [
      {
        text: "先跟大家讲一下我们未来的 AI 工作需求梳理。",
        annotationIds: ["A1"],
      },
      {
        text: "后续 AI 工作会以几个不同的层次推进，未来会分为三个层次：全研发域通用层、领域共性层和重点领域专用技术层。",
        annotationIds: ["A2"],
      },
    ],
  },
  {
    id: "P2",
    speaker: "说话人 4",
    timestamp: "03:12",
    fragments: [
      {
        text: "全研发域通用层可能由公司研发主导，我这边协助推进 AI 提效运营工作，产品、项目等相关事项会共同推动。",
        annotationIds: ["A3"],
      },
    ],
  },
  {
    id: "P3",
    speaker: "说话人 4",
    timestamp: "03:46",
    fragments: [
      {
        text: "领域共性层可能推进法规、交付审核、BOM 管理问答助手和 AI 辅助代码开发等工作。",
      },
    ],
  },
  {
    id: "P4",
    speaker: "说话人 2",
    timestamp: "04:16",
    fragments: [
      { text: "建议先把需求场景和使用边界梳理清楚，" },
      {
        text: "再确定哪些能力属于通用层，哪些能力由专业领域自行建设。",
        annotationIds: ["A4"],
      },
    ],
  },
  {
    id: "P5",
    speaker: "说话人 5",
    timestamp: "05:08",
    fragments: [
      {
        text: "目前已经完成了初步需求收集和领导汇报，也与相关老师建立了协同推进机制。",
        annotationIds: ["A5"],
      },
    ],
  },
  {
    id: "P6",
    speaker: "说话人 4",
    timestamp: "06:20",
    fragments: [
      {
        text: "下一步要明确各层级负责人、优先级和交付计划，同时选择两个典型场景进行快速验证。",
        annotationIds: ["A6", "A11"],
      },
    ],
  },
  {
    id: "P7",
    speaker: "说话人 3",
    timestamp: "08:12",
    fragments: [
      {
        text: "采用分层建设的方式比较清晰，",
        annotationIds: ["A7"],
      },
      {
        text: "能够避免通用能力重复建设，也方便专业场景快速落地。",
        annotationIds: ["A8"],
      },
    ],
  },
  {
    id: "P8",
    speaker: "说话人 6",
    timestamp: "11:08",
    fragments: [
      {
        text: "建议重点关注模型输出的可解释性，所有结论最好能够关联回原始会议内容。",
        annotationIds: ["A9"],
      },
    ],
  },
  {
    id: "P9",
    speaker: "说话人 7",
    timestamp: "12:45",
    fragments: [
      {
        text: "还需要补充数据权限、敏感信息处理和结果人工确认机制，避免自动总结造成误解。",
        annotationIds: ["A10"],
      },
    ],
  },
];

// 注释实例严格按原始文字稿的出现顺序排列。同一维度可以出现多次，
// 同一句可通过 annotationIds 同时关联多个维度；每次命中仍保留独立总结。
export const summaries: Summary[] = [
  {
    id: "A1",
    key: "topic",
    title: "课题",
    summary: "提出本次讨论的核心课题：梳理研发领域未来的 AI 工作需求。",
    confidence: 94,
    evidenceId: "P1",
  },
  {
    id: "A2",
    key: "goal",
    title: "课题目标",
    summary: "规划通用层、领域共性层和专业技术层三个建设层级。",
    confidence: 95,
    evidenceId: "P1",
  },
  {
    id: "A3",
    key: "topic",
    title: "课题",
    summary: "进一步明确通用层的主导与协同方式，以及 AI 提效运营的推进范围。",
    confidence: 91,
    evidenceId: "P2",
  },
  {
    id: "A4",
    key: "goal",
    title: "课题目标",
    summary: "需要划分通用能力与专业领域自建能力的边界。",
    confidence: 90,
    evidenceId: "P4",
  },
  {
    id: "A5",
    key: "progress",
    title: "课题进展",
    summary: "已完成初步需求收集、领导汇报和协同机制建立。",
    confidence: 93,
    evidenceId: "P5",
  },
  {
    id: "A6",
    key: "next",
    title: "后续目标",
    summary: "明确负责人、优先级和交付计划，并选择典型场景开展验证。",
    confidence: 92,
    evidenceId: "P6",
  },
  {
    id: "A11",
    key: "goal",
    title: "课题目标",
    summary: "通过典型场景验证三层 AI 建设方案的实际可行性。",
    confidence: 88,
    evidenceId: "P6",
  },
  {
    id: "A7",
    key: "topic",
    title: "课题",
    summary: "再次确认分层建设是当前 AI 工作方案的核心讨论方向。",
    confidence: 89,
    evidenceId: "P7",
  },
  {
    id: "A8",
    key: "highlight",
    title: "亮点总结",
    summary: "分层建设可减少通用能力重复投入，并提升专业场景落地效率。",
    confidence: 91,
    evidenceId: "P7",
  },
  {
    id: "A9",
    key: "advice",
    title: "评委分享及建议",
    summary: "重点关注模型结果可解释性，并让结论能够追溯到原始会议内容。",
    confidence: 94,
    evidenceId: "P8",
  },
  {
    id: "A10",
    key: "advice",
    title: "评委分享及建议",
    summary: "补充数据权限、敏感信息处理和结果人工确认机制。",
    confidence: 93,
    evidenceId: "P9",
  },
];
