ARG APP_PATH=/opt/outline

# --- Build stage (from source, not upstream image) ---
FROM node:24.14.1 AS base

ARG APP_PATH
WORKDIR $APP_PATH

COPY ./package.json ./yarn.lock ./.yarnrc.yml ./
COPY ./patches ./patches

RUN apt-get update && apt-get install -y cmake
ENV NODE_OPTIONS="--max-old-space-size=24000"

RUN corepack enable
RUN yarn install --immutable --network-timeout 1000000 && \
  yarn cache clean

COPY . .
ARG CDN_URL
RUN yarn build

RUN yarn workspaces focus --production && \
  yarn cache clean

ENV PORT=3000

# --- Runner stage ---
FROM node:24.14.1-slim AS runner

LABEL org.opencontainers.image.source="https://github.com/outline/outline"

ARG APP_PATH
WORKDIR $APP_PATH
ENV NODE_ENV=production

RUN addgroup --gid 1001 nodejs && \
    adduser --uid 1001 --ingroup nodejs nodejs && \
    mkdir -p /var/lib/outline && \
    chown -R nodejs:nodejs /var/lib/outline && \
    chown -R nodejs:nodejs $APP_PATH

COPY --from=base --chown=nodejs:nodejs $APP_PATH/build ./build
COPY --from=base --chown=nodejs:nodejs $APP_PATH/server ./server
COPY --from=base --chown=nodejs:nodejs $APP_PATH/public ./public
COPY --from=base --chown=nodejs:nodejs $APP_PATH/.sequelizerc ./.sequelizerc
COPY --from=base --chown=nodejs:nodejs $APP_PATH/node_modules ./node_modules
COPY --from=base --chown=nodejs:nodejs $APP_PATH/package.json ./package.json

RUN  apt-get update \
    && apt-get install -y wget \
    && npm install -g opencode-ai \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

ENV FILE_STORAGE_LOCAL_ROOT_DIR=/var/lib/outline/data \
    OPENCODE_DIR=/var/lib/outline/opencode \
    OPENCODE_CONFIG_DIR=/var/lib/outline/opencode-config
RUN mkdir -p "$FILE_STORAGE_LOCAL_ROOT_DIR" && \
    mkdir -p "$OPENCODE_DIR" "$OPENCODE_CONFIG_DIR" && \
    chown -R nodejs:nodejs "$FILE_STORAGE_LOCAL_ROOT_DIR" && \
    chown -R nodejs:nodejs "$OPENCODE_DIR" "$OPENCODE_CONFIG_DIR" && \
    chmod 1777 "$FILE_STORAGE_LOCAL_ROOT_DIR" "$OPENCODE_DIR" "$OPENCODE_CONFIG_DIR"

USER nodejs

HEALTHCHECK --interval=1m CMD wget -qO- "http://localhost:${PORT:-3000}/_health" | grep -q "OK" || exit 1

EXPOSE 3000
CMD ["node", "build/server/index.js"]
