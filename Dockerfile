FROM node:20-bookworm-slim

# Install system dependencies (Python, FFmpeg, required for yt-dlp)
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv ffmpeg wget curl && \
    rm -rf /var/lib/apt/lists/*

# Create a Python virtual environment and install the latest yt-dlp
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip3 install --no-cache-dir yt-dlp

# Set working directory
WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application
COPY . .

# Expose port (Koyeb defaults to 8000 for web services, but we'll use standard 3000 and let Koyeb port map)
EXPOSE 3000
ENV PORT=3000

# Start the server
CMD ["npm", "start"]
