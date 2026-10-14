# Chausar hosted services. One image, two roles: `api` and `worker`. Written and tested, not deployed.
FROM node:24.13.1-bookworm-slim
ENV NODE_ENV=production
WORKDIR /srv/chausar-hosted
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY . .
RUN useradd --system --uid 10001 --home /srv/chausar-hosted chausar && mkdir -p /var/lib/chausar/backups && chown chausar /var/lib/chausar/backups
USER chausar
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "server.ts"]
CMD ["api"]
