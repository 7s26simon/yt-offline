import express from "express";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, createReadStream, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOAD_DIR = path.join(__dirname, "downloads");
mkdirSync(DOWNLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// In-memory job registry: jobId -> { status, percent, speed, eta, title, file, error }
const jobs = new Map();

// Locate the yt-dlp / ffmpeg binaries (Homebrew or PATH).
const YTDLP = process.env.YTDLP_PATH || "yt-dlp";

/** Run yt-dlp and collect stdout. Rejects on non-zero exit. */
function runYtdlp(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(err || `yt-dlp exited ${code}`))
    );
  });
}

/** POST /api/info  { url } -> { title, thumbnail, duration, uploader, formats[] } */
app.post("/api/info", async (req, res) => {
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Provide a valid http(s) URL." });
  }
  try {
    const raw = await runYtdlp(["-J", "--no-playlist", url]);
    const info = JSON.parse(raw);

    // Build a friendly, de-duplicated list of progressive/merged video heights.
    const heights = new Set();
    for (const f of info.formats || []) {
      if (f.vcodec && f.vcodec !== "none" && f.height) heights.add(f.height);
    }
    const videoQualities = [...heights]
      .sort((a, b) => b - a)
      .map((h) => ({ id: `mp4-${h}`, label: `${h}p MP4`, height: h, kind: "video" }));

    const audioQualities = [
      { id: "mp3-320", label: "MP3 320kbps", kind: "audio", abr: 320 },
      { id: "mp3-128", label: "MP3 128kbps", kind: "audio", abr: 128 },
    ];

    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      uploader: info.uploader || info.channel,
      formats: [...videoQualities, ...audioQualities],
    });
  } catch (e) {
    res.status(500).json({ error: cleanErr(e.message) });
  }
});

/** POST /api/download  { url, formatId } -> { jobId } */
app.post("/api/download", (req, res) => {
  const { url, formatId } = req.body || {};
  if (!url || !formatId) return res.status(400).json({ error: "url and formatId required" });

  const jobId = randomUUID();
  const jobDir = path.join(DOWNLOAD_DIR, jobId);
  mkdirSync(jobDir, { recursive: true });
  jobs.set(jobId, { status: "starting", percent: 0 });

  const outTpl = path.join(jobDir, "%(title)s.%(ext)s");
  let args;

  if (formatId.startsWith("mp3-")) {
    const abr = formatId.split("-")[1];
    args = [
      "-x", "--audio-format", "mp3", "--audio-quality", `${abr}K`,
      "--no-playlist", "--newline",
      "-o", outTpl, url,
    ];
  } else {
    const height = formatId.split("-")[1];
    args = [
      "-f", `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
      "--merge-output-format", "mp4",
      "--no-playlist", "--newline",
      "-o", outTpl, url,
    ];
  }

  const proc = spawn(YTDLP, args);
  const job = jobs.get(jobId);
  job.status = "downloading";

  const onLine = (buf) => {
    const text = buf.toString();
    // yt-dlp progress line: "[download]  42.3% of 10.00MiB at 2.00MiB/s ETA 00:03"
    const m = text.match(/\[download\]\s+([\d.]+)% of/);
    if (m) job.percent = parseFloat(m[1]);
    const sp = text.match(/at\s+([\d.]+\w+\/s)/);
    if (sp) job.speed = sp[1];
    const eta = text.match(/ETA\s+([\d:]+)/);
    if (eta) job.eta = eta[1];
    if (/Merging formats|ExtractAudio|Destination/.test(text)) job.status = "processing";
  };
  proc.stdout.on("data", onLine);
  proc.stderr.on("data", onLine);

  proc.on("close", (code) => {
    if (code === 0) {
      const files = readdirSync(jobDir);
      const file = files.find((f) => !f.endsWith(".part")) || files[0];
      job.status = "done";
      job.percent = 100;
      job.file = file;
      job.title = file;
    } else {
      job.status = "error";
      job.error = "Download failed. The URL may be unsupported or restricted.";
    }
  });
  proc.on("error", () => {
    job.status = "error";
    job.error = "yt-dlp not found. Install it (brew install yt-dlp ffmpeg).";
  });

  res.json({ jobId });
});

/** GET /api/progress/:jobId -> Server-Sent Events stream of job state. */
app.get("/api/progress/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).end();

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const tick = setInterval(() => {
    res.write(`data: ${JSON.stringify(job)}\n\n`);
    if (job.status === "done" || job.status === "error") {
      clearInterval(tick);
      res.end();
    }
  }, 400);

  req.on("close", () => clearInterval(tick));
});

/** GET /api/file/:jobId -> serves the finished file as a download. */
app.get("/api/file/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== "done" || !job.file) return res.status(404).end();
  const filePath = path.join(DOWNLOAD_DIR, req.params.jobId, job.file);
  if (!existsSync(filePath)) return res.status(404).end();
  res.download(filePath, job.file);
});

function cleanErr(msg) {
  if (/not found|ENOENT/.test(msg)) return "yt-dlp is not installed. Run: brew install yt-dlp ffmpeg";
  return msg.split("\n").find((l) => l.includes("ERROR")) || "Could not fetch video info.";
}

// Optional: purge downloads older than 6h on boot.
for (const d of existsSync(DOWNLOAD_DIR) ? readdirSync(DOWNLOAD_DIR) : []) {
  const p = path.join(DOWNLOAD_DIR, d);
  try {
    if (Date.now() - statSync(p).mtimeMs > 6 * 3600e3) rmSync(p, { recursive: true, force: true });
  } catch {}
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n  YT-Offline running →  http://localhost:${PORT}\n`));
