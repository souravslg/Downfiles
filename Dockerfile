FROM node:20-alpine

# Install Python, pip, and ffmpeg
RUN apk add --no-cache python3 py3-pip ffmpeg

WORKDIR /app

# Create python → python3 symlink (needed for yt-dlp detection)
RUN ln -sf /usr/bin/python3 /usr/bin/python || true

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
