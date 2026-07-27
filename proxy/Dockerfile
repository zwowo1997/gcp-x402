# Multi-stage build for the gcp-x402 proxy (Next.js standalone) on Cloud Run.

# 1) install deps
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# 2) build the standalone server
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholders so config validation passes during `next build`. These are NOT
# baked into runtime behavior — the standalone server reads process.env fresh at
# request time, where Cloud Run supplies the real values.
ENV NEXT_TELEMETRY_DISABLED=1 \
    GCP_PROJECT_ID=build-placeholder \
    PAY_TO_ADDRESS=0x0000000000000000000000000000000000000000 \
    QUOTE_SECRET=build-placeholder \
    RESOURCE_CAPABILITY_SECRET=build-placeholder \
    BETA_ACCESS_PASSWORD=build-placeholder \
    BETA_SESSION_SECRET=build-placeholder
RUN npm run build

# 3) minimal runtime image
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
# Standalone output bundles only the files the server actually needs.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Next standalone tracing misses JSON configuration files loaded dynamically by
# the Google Cloud clients (notably Cloud Tasks). Keep this small scope intact.
COPY --from=build /app/node_modules/@google-cloud ./node_modules/@google-cloud
EXPOSE 8080
# No credentials baked in: on Cloud Run, BigQuery auth comes from the attached
# service account via Application Default Credentials.
CMD ["node", "server.js"]
