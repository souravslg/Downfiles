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

# Install latest yt-dlp + PO Token Provider
RUN pip3 install -U --pre yt-dlp curl_cffi==0.7.4 yt-dlp-get-pot bgutil-ytdlp-pot-provider --break-system-packages

# CACHE BUST: forces Docker to re-run everything below this line on every build
ARG CACHEBUST=20260224_2210

# Copy app source
COPY . .

# Build bgutil to produce generate_once.js
WORKDIR /app/bgutil-server
RUN npm install && npx tsc

# Create default path expected by GetPOT plugin to avoid yt-dlp extractor-args syntax hell
RUN mkdir -p /root/bgutil-ytdlp-pot-provider/server/build && \
    ln -s /app/bgutil-server/build/generate_once.js /root/bgutil-ytdlp-pot-provider/server/build/generate_once.js

WORKDIR /app

# Start the server
EXPOSE 3000
CMD ["npm", "start"]
