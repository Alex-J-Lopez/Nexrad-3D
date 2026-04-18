# Nexrad 3D
<img width="1800" height="999" alt="image" src="https://github.com/user-attachments/assets/7e11798a-1000-4972-a574-803b15adb7dc" />


Nexrad 3D is a web-native radar platform inspired by [OpenStorm](https://github.com/JordanSchlick/OpenStorm). It provides a modern 3D globe experience, near-real-time radar updates, and radar-source switching.

## Repository Layout

- apps/nexrad: Next.js frontend and API routes with MapLibre globe and local volume ray-march renderers.
- services/ingest-worker: Backend service that polls upstream radar manifests and publishes readiness events.
- packages/contracts: Shared runtime schemas and TypeScript contracts.
- packages/radar-parser: Portable parser interfaces for NEXRAD Level 2 and ODIM H5 formats.
- packages/radar-colors: Radar product color scales and lookup helpers.
- infra/docker: Local Redis, MinIO object-storage emulation, and app services via Docker Compose.

## Quick Start

### Run via Docker (Full Stack)
1. Copy `.env.example` to `.env` and adjust values as needed.
2. Start everything (frontend, worker, redis, minio):
   ```bash
   npm run infra:up
   ```
3. Open frontend at http://localhost:3000.

### Local Development
If you prefer to run the Node/Next.js services locally for development:
1. Copy `.env.example` to `.env`.
2. Start just the infrastructure dependencies:
   ```bash
   docker compose -f infra/docker/docker-compose.yml up -d redis minio minio-init
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the dev servers (frontend and worker):
   ```bash
   npm run dev
   ```
5. Open frontend at http://localhost:3000.
