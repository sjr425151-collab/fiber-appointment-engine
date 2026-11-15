# Production image: one Node process serves the API and the built site.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    PORT=3001 \
    DATABASE_PATH=/data/fiber.db
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN NODE_ENV=development npm run build
# SQLite lives on a persistent volume
VOLUME ["/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "server/index.ts"]
