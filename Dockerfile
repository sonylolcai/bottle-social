FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages packages

RUN pnpm install --frozen-lockfile

WORKDIR /app/packages/remote-worker

EXPOSE 8787

CMD ["sh", "-c", "pnpm exec wrangler d1 migrations apply drift-bottle --local && pnpm exec wrangler dev --local --ip 0.0.0.0 --port 8787"]
