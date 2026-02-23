FROM nikolaik/python-nodejs:python3.11-nodejs20

# Install ffmpeg and wget
RUN apt-get update && \
    apt-get install -y ffmpeg curl wget && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install --production

# Install latest yt-dlp and dependencies
RUN pip3 install -U --pre yt-dlp curl-cffi --break-system-packages

# Install yt-dlp PoToken provider plugin so yt-dlp can use Node.js natively
# This is what enables yt-dlp to solve YouTube bot-protection challenges
RUN pip3 install -U yt-dlp-get-pot bgutil-ytdlp-pot-provider --break-system-packages

# Copy app source
COPY . .

# Start the server
EXPOSE 3000
CMD ["npm", "start"]
