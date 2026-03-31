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
COPY docker/entrypoint.sh /usr/local/bin/tt-queue-bot-entrypoint.sh

RUN chmod +x /usr/local/bin/tt-queue-bot-entrypoint.sh

ENV MONGODB_HOST=mongodb \
    MONGODB_PORT=27017 \
    MONGODB_DB=tt-queue-bot \
    MONGODB_AUTH_SOURCE=admin

USER node

ENTRYPOINT ["/usr/local/bin/tt-queue-bot-entrypoint.sh"]
CMD ["node", "src/index.js"]
