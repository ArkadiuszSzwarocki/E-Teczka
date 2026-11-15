FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY account.html accountAction.html account.css accountAction.js accountUi.js cloudflareGate.js proxyGate.js googleIdentity.js httpApp.js index.js ./
COPY mariadb/ ./mariadb/
USER node
ENV NODE_ENV=production
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "umask 077; exec node index.js"]
