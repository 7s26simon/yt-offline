# YT-Offline

A local, self-hosted offline video downloader. It is a clean reimplementation of the kind of
web app that sites like ytdown.to provide: paste a link, pick a quality, and save the video for
offline viewing.

Under the hood it is a small Node/Express server that drives **yt-dlp** (extraction and download)
and **ffmpeg** (merging video and audio, MP3 conversion). That is the same engine those sites use,
but here it runs entirely on your own machine. Nothing is uploaded to a third party.

## Features

- Paste any supported URL and fetch the title, thumbnail, and available qualities.
- Download MP4 by resolution (up to the source maximum) or extract MP3 audio.
- Live download progress with speed and ETA, streamed over Server-Sent Events.
- Modern glassmorphic UI with an animated background.
- Light and dark themes plus five accent color palettes, with your choice saved between visits.
- Double-clickable macOS start and stop scripts.

## Requirements

- Node.js 18 or newer
- `yt-dlp` and `ffmpeg` available on your PATH:
  ```sh
  brew install yt-dlp ffmpeg      # macOS
  ```

## Run

```sh
npm install
npm start                 # http://localhost:3000
PORT=3100 npm start       # custom port
```

Open the URL, paste a video link, click **Fetch**, choose a format (MP4 by resolution, or MP3
audio), then **Download**. A progress bar streams live, and when it finishes a link appears to
save the file to your device. Files are also kept under `downloads/` and are auto-purged after
6 hours.

### macOS shortcuts

Two double-clickable files are included:

- `Start YT-Offline.command` starts the server in the background and opens it in your browser.
- `Stop YT-Offline.command` shuts the server down.

The first time you open each one, macOS may block it because it came from outside the App Store.
Right-click the file and choose **Open** once to approve it, after which a normal double-click works.

## How it works

| Endpoint | Purpose |
|---|---|
| `POST /api/info` | runs `yt-dlp -J` and returns title, thumbnail, and available qualities |
| `POST /api/download` | spawns yt-dlp, returns a `jobId`, and tracks progress |
| `GET /api/progress/:jobId` | Server-Sent Events stream of percent, speed, and ETA |
| `GET /api/file/:jobId` | serves the finished file |

## Legal

This runs locally, but you are responsible for what you download. Downloading copyrighted
material without permission may be unlawful, and YouTube's Terms of Service prohibit downloading
from it. Use it for content you own, for Creative Commons or public-domain works, or where you
otherwise have the right.

## License

Released under the [MIT License](LICENSE).
