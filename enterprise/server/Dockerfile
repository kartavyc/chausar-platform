# Chausar enterprise server image. EXPERIMENTAL: not deployed, not reviewed for production.
# Build from the repository root:
#   docker build -f enterprise/server/Dockerfile -t chausar-enterprise:dev .
# No secrets are baked in. Configuration, TLS files, the client secret, the workspace
# passphrase and the database URL are mounted at run time (see compose.yaml and README.md).
FROM node:24.13.1-bookworm-slim

ENV NODE_ENV=production
WORKDIR /opt/chausar

# Production dependencies only; no install scripts run.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Only the paths the engine and the enterprise server load at run time.
COPY platform/runtime platform/runtime
COPY platform/semantic-qualification/src platform/semantic-qualification/src
COPY platform/helpers platform/helpers
COPY app/desktop/ipc-contract.cjs app/desktop/ui-assets.cjs app/desktop/
COPY app/desktop/module-methods app/desktop/module-methods
COPY app/ui/host app/ui/host
COPY app/ui/public app/ui/public
COPY app/ui/assets/fonts app/ui/assets/fonts
COPY enterprise/server/config.ts enterprise/server/oidc.ts enterprise/server/identity.ts enterprise/server/server.ts enterprise/server/main.ts enterprise/server/
COPY enterprise/server/ui enterprise/server/ui

RUN groupadd --system --gid 10001 chausar \
 && useradd --system --uid 10001 --gid chausar --home-dir /var/lib/chausar --shell /usr/sbin/nologin chausar \
 && mkdir -p /var/lib/chausar/server /var/lib/chausar/vaults \
 && chown -R chausar:chausar /var/lib/chausar \
 && chmod 700 /var/lib/chausar /var/lib/chausar/server /var/lib/chausar/vaults

USER chausar
ENV CHAUSAR_ENTERPRISE_CONFIG=/etc/chausar/config.json
EXPOSE 8443
# The probe stays inside the container on loopback; it reads only /healthz.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "require('node:https').get({host:'127.0.0.1',port:8443,path:'/healthz',rejectUnauthorized:false,timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
CMD ["node", "enterprise/server/main.ts"]
