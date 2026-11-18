# Single-service image for Render: serves the web app (website, customer app, admin and
# partner portals) and the API from ONE origin, because the web app calls /api/v1 on its own
# origin and uses same-origin session cookies. Build context is the repository root.

FROM node:24.22.0-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY web/ ./
# Optional browser Google Maps key (referrer-restricted; not a secret). Empty = OpenStreetMap fallback map.
ARG VITE_GOOGLE_MAPS_BROWSER_KEY=
ENV VITE_GOOGLE_MAPS_BROWSER_KEY=$VITE_GOOGLE_MAPS_BROWSER_KEY
RUN npm run build

FROM node:24.22.0-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx gettext-base openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/ ./

# The Supabase database certificate. The API verifies the database TLS certificate
# (rejectUnauthorized: true) and Supabase uses its own CA, which Node does not trust by default.
# It is a public certificate. Put it at backend/certs/supabase-ca-2021.crt before building.
RUN test -s certs/supabase-ca-2021.crt \
 || (echo "MISSING backend/certs/supabase-ca-2021.crt - copy the Supabase CA certificate there (see docs/DEPLOYMENT.md)." && exit 1) \
 && openssl x509 -in certs/supabase-ca-2021.crt -noout
ENV NODE_EXTRA_CA_CERTS=/app/backend/certs/supabase-ca-2021.crt

COPY --from=web-build /web/dist /usr/share/nginx/html
COPY deploy/nginx.conf.template /etc/nginx/nearpill.conf.template
COPY deploy/nginx-headers-portal.conf deploy/nginx-headers-app.conf /etc/nginx/snippets/
COPY deploy/start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]
