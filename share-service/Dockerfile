FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
