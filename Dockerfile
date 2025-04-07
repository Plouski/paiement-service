FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# Use wildcard to copy both package.json AND package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Create log directory
RUN mkdir -p logs

# Bundle app source
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5004

# Expose the service port
EXPOSE 5004

# Run the service
CMD ["node", "index.js"]