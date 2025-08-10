# Dockerfile
# Mini README:
# - Purpose: containerise the Mingle server with a production-ready Node runtime.
# - Structure:
#   1. Builder stage installs all dependencies and compiles TypeScript.
#   2. Runtime stage installs only production deps and copies compiled output.
# - Notes: expose PORT for configuration; defaults to 3000 inside the container.

FROM node:20-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /usr/src/app/dist ./dist
COPY public ./public
EXPOSE 3000
ENV PORT=3000
CMD ["node", "dist/mingle_server.js"]
