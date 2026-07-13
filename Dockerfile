# ── Stage 1: build the TypeScript into dist/ ───────────────────────────────
FROM apify/actor-node:20 AS builder

# Copy manifests first to leverage Docker layer caching.
COPY package*.json ./

# Install ALL dependencies (incl. dev) so tsc is available. Skip audit for speed.
RUN npm install --include=dev --audit=false

# Copy the rest of the source and compile.
COPY . ./
RUN npm run build

# ── Stage 2: lean runtime image ────────────────────────────────────────────
FROM apify/actor-node:20

# Bring in only the compiled output from the builder stage.
COPY --from=builder /usr/src/app/dist ./dist

# Copy manifests and install production-only dependencies.
COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version \
    && rm -r ~/.npm

# Copy the remaining files (.actor/, etc.) needed at runtime.
COPY . ./

# Start the Actor.
CMD npm run start:prod --silent
