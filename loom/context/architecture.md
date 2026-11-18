# Loom Context — Architecture

5-layer: Connectors → Domain Models → Services → API+MCP → UI & AI Surfaces.
Fixed ports: React 8899, Express 8001. Single React runtime.
Shared kernel: `platform/` (email + AI) + `shared/` (connectors/domain). Product homes: `lighthouse/` + `loom/` (each owns mcp/skills/rules/docs per D44).
