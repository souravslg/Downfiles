FROM nikolaik/python-nodejs:python3.11-nodejs20

# Install system dependencies (Python is already installed in this image, add FFmpeg)
RUN apt-get update && \
    apt-get install -y ffmpeg wget curl unzip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install the latest yt-dlp and the essential PO Token Providers to bypass Bot Verification
RUN pip3 install --no-cache-dir -U --pre yt-dlp curl_cffi==0.7.4 yt-dlp-get-pot bgutil-ytdlp-pot-provider

# Set working directory to the API server
WORKDIR /app
COPY . .

# Compile the bgutil-server for Native JS challenge solving
WORKDIR /app/bgutil-server
RUN npm install && npx tsc

# Symlink the built generator script into the root path that yt-dlp expects
RUN mkdir -p /root/bgutil-ytdlp-pot-provider/server/build && \
    ln -s /app/bgutil-server/build/generate_once.js /root/bgutil-ytdlp-pot-provider/server/build/generate_once.js

WORKDIR /app

# Install main Node dependencies
RUN npm install --omit=dev

# Expose standard port
EXPOSE 3000
ENV PORT=3000

# Start the server
CMD ["npm", "start"]
