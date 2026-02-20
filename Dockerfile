FROM node:20-alpine

# Install Python, pip, and ffmpeg
RUN apk add --no-cache python3 py3-pip ffmpeg

WORKDIR /app

# Install yt-dlp via pip
RUN pip3 install yt-dlp --break-system-packages

# Copy package files and install Node dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of the app
COPY . .

EXPOSE 3000
CMD ["node", "server/index.js"]
