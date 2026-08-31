# syntax=docker/dockerfile:1.7
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json eslint.config.js vitest.config.ts ./
COPY src ./src
COPY tests ./tests
RUN pnpm lint && pnpm typecheck && RUN_BROWSER_TESTS=true pnpm test && pnpm build && pnpm prune --prod

FROM mcr.microsoft.com/playwright:v1.62.1-noble AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

COPY --from=build --chown=pwuser:pwuser /app/package.json ./package.json
COPY --from=build --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /app/dist ./dist

USER pwuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
