# Build from the repository root:  docker build -f server/Dockerfile .
FROM node:22-alpine

LABEL org.opencontainers.image.title="PrintHour"
LABEL org.opencontainers.image.description="3D printing cost, inventory and quoting, backed by a SQLite file"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app
COPY server/server.js ./
COPY app ./public

ENV PORT=3737
ENV DB_PATH=/data/printhour.sqlite
ENV KEEP_BACKUPS=14

RUN addgroup -g 1500 printhour && adduser -D -u 1500 -G printhour printhour

# /data must exist in the image and be owned by the app user BEFORE it is
# declared a volume. Docker seeds an empty named volume from the image
# directory, ownership included — without this the volume arrives owned by
# root and the container cannot write to its own database.
RUN mkdir -p /data && chown printhour:printhour /data
VOLUME ["/data"]

EXPOSE 3737
USER printhour

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3737/api/health || exit 1

CMD ["node", "server.js"]
