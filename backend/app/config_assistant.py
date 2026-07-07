from .llm import LLMProvider
from .models import AnalysisDimensionConfig, ConfigOperation


class ConfigOperationError(ValueError):
    pass


def interpret_config_request(
    provider: LLMProvider,
    messages: list[dict[str, str]],
    dimensions: list[dict],
) -> dict:
    return provider.interpret_config(messages, dimensions)


def apply_config_operations(
    dimensions: list[AnalysisDimensionConfig],
    operations: list[ConfigOperation],
) -> tuple[list[AnalysisDimensionConfig], list[str]]:
    current = [dimension.model_copy(deep=True) for dimension in dimensions]
    affected: list[str] = []

    for operation in operations:
        index = _find_dimension(current, operation.dimension_key)
        if operation.type == "add_dimension":
            key = _next_custom_key(current)
            current.append(
                AnalysisDimensionConfig(
                    key=key,
                    label=operation.label or "",
                    description=operation.description or "",
                    enabled=True,
                )
            )
            affected.append(key)
            continue

        if index is None:
            raise ConfigOperationError(f"找不到分析维度：{operation.dimension_key}。")

        target = current[index]
        if operation.type == "remove_dimension":
            current.pop(index)
        elif operation.type == "update_dimension":
            current[index] = target.model_copy(
                update={
                    "label": operation.label or target.label,
                    "description": operation.description or target.description,
                }
            )
        elif operation.type == "enable_dimension":
            current[index] = target.model_copy(update={"enabled": True})
        elif operation.type == "disable_dimension":
            current[index] = target.model_copy(update={"enabled": False})
        affected.append(target.key)

    labels = [dimension.label.strip() for dimension in current]
    if len(labels) != len(set(labels)):
        raise ConfigOperationError("分析维度名称不能重复。")
    return current, list(dict.fromkeys(affected))


def _find_dimension(
    dimensions: list[AnalysisDimensionConfig], key: str | None
) -> int | None:
    if key is None:
        return None
    return next(
        (index for index, dimension in enumerate(dimensions) if dimension.key == key),
        None,
    )


def _next_custom_key(dimensions: list[AnalysisDimensionConfig]) -> str:
    used = {dimension.key for dimension in dimensions}
    for index in range(10000):
        key = f"custom_{index}"
        if key not in used:
            return key
    raise ConfigOperationError("没有可用的自定义维度标识。")
