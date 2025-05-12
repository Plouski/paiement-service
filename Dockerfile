# Choisir une image Node stable
FROM node:20

# Créer un dossier de travail
WORKDIR /app

# Copier les fichiers package.json et package-lock.json
COPY package*.json ./

# Fixer les problèmes de connexion NPM dans Docker
RUN npm config set registry https://registry.npmjs.org/

# Installer nodemon globalement (dev tools)
RUN npm install -g nodemon

# Installer les dépendances du projet
RUN npm install

# Copier tout le code source
COPY . .

# Exposer le port par défaut (à adapter si nécessaire)
EXPOSE 5004

# Lancer le service
CMD ["npm", "run", "dev"]
