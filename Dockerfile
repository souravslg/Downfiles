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

# Install latest yt-dlp
RUN pip3 install -U --pre yt-dlp curl-cffi --break-system-packages
# CACHE BUST: forces Docker to re-run everything below this line on every build
ARG CACHEBUST=20260223_2200


# Copy app source
COPY . .

# Start the server
EXPOSE 3000
CMD ["npm", "start"]
