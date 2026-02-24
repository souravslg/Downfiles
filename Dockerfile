FROM nikolaik/python-nodejs:python3.11-nodejs20

# Install system dependencies (Python is already installed in this image, add FFmpeg)
RUN apt-get update && \
    apt-get install -y ffmpeg wget curl unzip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install the latest yt-dlp
RUN pip3 install --no-cache-dir -U --pre yt-dlp

# Set working directory to the API server
WORKDIR /app
COPY . .

# Install main Node dependencies
RUN npm install --omit=dev

# Expose standard port
EXPOSE 3000
ENV PORT=3000

# Start the server
CMD ["npm", "start"]
