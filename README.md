# DownFiles 🎬

A fast, free, ad-free video downloader for 50+ platforms — similar to downbot.app.

> Supports YouTube, TikTok, Instagram, Twitter, Facebook, Vimeo and 50+ more.

## Features

- ⬇️ Download videos from 50+ platforms
- 🎵 Audio-only MP3 extraction
- 🚫 No watermark downloads (TikTok, Instagram)
- 📹 Up to 8K quality (with ffmpeg)
- 🔒 No sign-up, no ads, 100% private
- ⚡ Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp)

## Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS (Glassmorphism dark theme), Vanilla JS |
| Backend | Node.js + Express |
| Downloader | yt-dlp (Python) |
| Merger | ffmpeg (optional, enables 1080p+) |

## Setup

### 1. Prerequisites
- [Node.js](https://nodejs.org) v18+
- [Python](https://python.org) 3.8+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp): `pip install yt-dlp`
- **ffmpeg** (optional, for 1080p+): download `ffmpeg.exe` and place it in `server/`

### 2. Install & Run

```bash
git clone <your-repo-url>
cd Downfiles
npm install
npm start
```

Open **http://localhost:3000** in your browser.

## Usage

1. Paste any video URL into the input box
2. Click the **→** button to fetch video info
3. Choose your preferred quality and click **⬇️ Download Video** or **🎵 Audio Only**

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/info` | Get video metadata + available formats |
| GET | `/api/download` | Stream download (url, format_id, audio_only, title) |
| GET | `/api/status/:jobId` | Check download job status |

## Supported Platforms

YouTube, TikTok, Instagram, Twitter/X, Facebook, Vimeo, Dailymotion, Twitch, Reddit, Pinterest, Snapchat, SoundCloud, Tumblr, VK, LinkedIn, and 35+ more.

## Legal

This tool is for personal use only. Please respect platform terms of service and copyright law.
See [Terms](legal/terms.html) | [Privacy](legal/privacy.html) | [DMCA](legal/dmca.html)

---
Made with ♥ for the open web.
