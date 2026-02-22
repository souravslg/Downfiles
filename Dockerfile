FROM node:20

# Install Python, pip, ffmpeg and SSL libs for curl_cffi impersonation support
# NOTE: libssl-dev and ca-certificates are required for curl_cffi TLS fingerprinting
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg curl wget libssl-dev ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install yt-dlp + curl_cffi for --impersonate support (bypasses YouTube bot detection)
RUN pip3 install yt-dlp "curl_cffi==0.7.3" --break-system-packages && \
    yt-dlp --version && \
    python3 -c "import curl_cffi; print('curl_cffi OK:', curl_cffi.__version__)"

# Copy package files and install Node dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of the app
COPY . .

EXPOSE 3000
CMD ["node", "server/index.js"]
