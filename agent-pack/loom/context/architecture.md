# Loom Context — Architecture

5-layer: Connectors → Domain Models → Services → API+MCP → UI & AI Surfaces.
Fixed ports: React 8899, Express 8001. Single React runtime.
Shared kernel: `shared/` (5 connectors D3). Product packs: `agent-pack/product/*`.
