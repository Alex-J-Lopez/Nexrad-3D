# Nexrad 3D
<img width="1800" height="999" alt="image" src="https://github.com/user-attachments/assets/7e11798a-1000-4972-a574-803b15adb7dc" />


Nexrad 3D is a web-native radar platform inspired by OpenStorm. It provides a modern 3D globe experience, near-real-time radar updates, and radar-source switching without Unreal Engine runtime dependencies.

## Repository Layout

- apps/web: React + Vite frontend with Cesium globe rendering.
- apps/api: Node API for sites, latest volume metadata, timeline, and SSE events.
- services/ingest-worker: Polls upstream radar manifests and publishes readiness events.
- packages/contracts: Shared runtime schemas and TypeScript contracts.
- packages/radar-parser: Portable parser interfaces and format-detection scaffolding.
- packages/radar-colors: Radar product color scales and lookup helpers.
- infra/docker: Local Redis and object-storage emulation.

## Quick Start

1. Copy .env.example to .env and adjust values as needed.
2. Start local dependencies:

   npm run infra:up

3. Install dependencies:

   npm install

4. Start all services:

   npm run dev

5. Open frontend at http://localhost:5173.

## Initial Scope

- NEXRAD-first ingestion flow with adaptive polling.
- Shared contracts for API + worker + web.
- Cesium-based globe baseline.
- SSE event channel for live volume notifications.

## Next Milestones

- Download and persist radar artifacts to object storage.
- Port volumetric sweep parsing from OpenStorm into package parser implementations.
- Integrate renderer data path from API timeline + latest metadata into volume layer pipeline.
