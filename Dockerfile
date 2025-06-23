# syntax=docker.io/docker/dockerfile:1

FROM node:lts-slim AS base

# Install dependencies only when needed
FROM base AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential \
  python3 \
  pkg-config \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  libpixman-1-dev \
  libfreetype6-dev \
  libpng-dev \
  git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn


# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential \
  python3 \
  pkg-config \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  libpixman-1-dev \
  libfreetype6-dev \
  libpng-dev \
  git \
  && rm -rf /var/lib/apt/lists/*


# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
# ENV NEXT_TELEMETRY_DISABLED=1

ARG GEMINI_API_KEY

ENV GEMINI_API_KEY=$GEMINI_API_KEY


RUN yarn build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential \
  python3 \
  pkg-config \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  libpixman-1-dev \
  libfreetype6-dev \
  libpng-dev \
  git \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN yarn install

USER nextjs

EXPOSE 3000

ENV PORT=3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/config/next-config-js/output
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]