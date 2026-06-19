FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
# A porta efetiva vem de PORT/GAME (ver server.js). Documentadas as 3 padrão:
EXPOSE 4001 4002 4003
CMD ["npm", "start"]
