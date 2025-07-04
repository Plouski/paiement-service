FROM node:20-alpine

WORKDIR /app

# Copier les fichiers package.json et package-lock.json
COPY package*.json ./

# Installer nodemon globalement et les dépendances
RUN npm install -g nodemon && npm install

# Copier tout le code source
COPY . .

# Exposer les ports
EXPOSE 5004 9090

# Lancer le service
CMD ["npm", "run", "dev"]