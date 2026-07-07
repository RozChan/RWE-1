import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class LLMSettings:
    provider: str = "mock"
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-pro"
    deepseek_timeout_seconds: float = 120.0
    deepseek_max_tokens: int = 8192
    deepseek_thinking: str = "disabled"


def load_backend_env(path: Path | None = None) -> None:
    """Load backend/.env without overwriting process-level environment variables."""
    env_path = path or Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


def get_llm_settings() -> LLMSettings:
    load_backend_env()
    return LLMSettings(
        provider=os.getenv("LLM_PROVIDER", "mock").strip().lower(),
        deepseek_api_key=os.getenv("DEEPSEEK_API_KEY", "").strip(),
        deepseek_base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
        .strip()
        .rstrip("/"),
        deepseek_model=os.getenv("DEEPSEEK_MODEL", "deepseek-v4-pro").strip(),
        deepseek_timeout_seconds=float(os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "120")),
        deepseek_max_tokens=int(os.getenv("DEEPSEEK_MAX_TOKENS", "8192")),
        deepseek_thinking=os.getenv("DEEPSEEK_THINKING", "disabled").strip(),
    )
