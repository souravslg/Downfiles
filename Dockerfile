FROM nikolaik/python-nodejs:python3.11-nodejs20

# Install ffmpeg and system deps
RUN apt-get update && \
    apt-get install -y ffmpeg curl wget unzip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies for main app
COPY package*.json ./
RUN npm install --production

# Install latest yt-dlp and PoToken provider plugin
RUN pip3 install -U --pre yt-dlp curl-cffi --break-system-packages && \
    pip3 install -U yt-dlp-get-pot bgutil-ytdlp-pot-provider --break-system-packages

# CACHE BUST: forces Docker to re-run everything below this line on every build
ARG CACHEBUST=20260223_2200

# Download the official pre-built bgutil server release v1.2.2
# Avoids TypeScript compilation entirely — uses official pre-compiled generate_once.js
RUN mkdir -p /app/bgutil && \
    wget -q "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/1.2.2/bgutil-ytdlp-pot-provider.zip" \
    -O /tmp/bgutil.zip && \
    unzip -q /tmp/bgutil.zip -d /tmp/bgutil-release && \
    find /tmp/bgutil-release -name "generate_once.js" | head -1 | xargs -I{} cp {} /app/bgutil/generate_once.js && \
    ls -la /app/bgutil/ && \
    rm -rf /tmp/bgutil.zip /tmp/bgutil-release && \
    echo "✅ bgutil generate_once.js installed from official release v1.2.2 in /app/bgutil"

# Copy app source
COPY . .

# Start the server
EXPOSE 3000
CMD ["npm", "start"]
