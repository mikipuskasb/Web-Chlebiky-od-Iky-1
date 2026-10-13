FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data COOKIE_SECURE=true
COPY --from=build /app/dist ./dist
COPY server.mjs ./server.mjs
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
