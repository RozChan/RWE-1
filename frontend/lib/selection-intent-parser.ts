export function extractTranslationLanguage(content: string, fallbackLanguage = "英文") {
  const match = /翻译(?:成|为|到)?\s*([^，。,.！？!?:：\s]+)/.exec(content);
  return match?.[1]?.trim() || fallbackLanguage;
}

export function parseSelectionDimensionIntent(content: string) {
  const match = /^(?:以|按|用)\s*(.+?)\s*维度分析(?:这段话)?$/.exec(content.trim());
  const label = match?.[1]?.trim();
  return label && label !== "当前" ? label : null;
}

export function isGlobalSelectionTask(content: string) {
  return /(分析全文|重新分析全文|导出|生成纪要|生成最终|生成输出|清空总结|覆盖已有总结|覆盖总结)/.test(content);
}
