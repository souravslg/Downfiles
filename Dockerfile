FROM nikolaik/python-nodejs:python3.11-nodejs20

# Install ffmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg curl wget && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install --production

# Install latest yt-dlp — Python and Node.js share the same PATH in this image
# so yt-dlp can natively call Node.js to solve YouTube bot-protection challenges
RUN pip3 install -U --pre yt-dlp curl-cffi --break-system-packages

# Copy app source
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
