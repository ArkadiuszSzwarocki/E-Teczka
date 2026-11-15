FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY account.html accountAction.js accountUi.js accountService.js cloudflareGate.js googleIdentity.js httpApp.js index.js rateLimit.js ./
USER node
ENV NODE_ENV=production
EXPOSE 3001
CMD ["sh", "-c", "umask 077; exec node index.js"]
