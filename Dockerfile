FROM node:20-slim

# Install Python, pip, and ffmpeg
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install yt-dlp and curl_cffi (required for --impersonate bypass)
RUN pip3 install yt-dlp curl_cffi --break-system-packages && \
    yt-dlp --version && \
    echo "yt-dlp installed successfully"

# Copy package files and install Node dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of the app
COPY . .

EXPOSE 3000
CMD ["node", "server/index.js"]
