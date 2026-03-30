FROM node:22-bookworm-slim AS test

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY src ./src
COPY jest.config.js ./
COPY jest.setup.js ./

RUN npm test

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=test /app/src ./src

USER node

CMD ["node", "src/index.js"]
