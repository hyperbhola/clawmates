FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY --from=builder /app/dist ./dist
COPY models/ ./models/ 2>/dev/null || true

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["node", "dist/index.js"]
