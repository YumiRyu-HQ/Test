const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const OpenAI = require("openai");
require("dotenv").config();

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VECTOR_STORE_ID = process.env.OPENAI_VECTOR_STORE_ID;
const SEARCH_MODEL = process.env.OPENAI_SEARCH_MODEL || "gpt-4.1-mini";

const upload = multer({
  dest: path.join(__dirname, ".uploads"),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const manifestPath = path.join(__dirname, "data", "openai-file-manifest.json");

function readManifest() {
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeManifest(data) {
  fs.writeFileSync(manifestPath, JSON.stringify(data, null, 2));
}

function upsertManifestItem(item) {
  const manifest = readManifest();
  const idx = manifest.findIndex((row) => row.file_id === item.file_id);
  if (idx >= 0) {
    manifest[idx] = { ...manifest[idx], ...item };
  } else {
    manifest.push(item);
  }
  writeManifest(manifest);
}

function collectText(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(collectText).filter(Boolean).join(" ");
  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    return Object.values(content).map(collectText).filter(Boolean).join(" ");
  }
  return "";
}

function extractFileSearchResults(response) {
  const output = Array.isArray(response.output) ? response.output : [];
  const rows = [];

  output.forEach((item) => {
    if (item && item.type === "file_search_call" && Array.isArray(item.results)) {
      item.results.forEach((result) => {
        rows.push({
          file_id: result.file_id || result.fileId || "",
          filename: result.filename || result.file_name || "",
          text: collectText(result.content).trim(),
          score: typeof result.score === "number" ? result.score : null,
        });
      });
    }
  });

  return rows;
}

function requireOpenAI(req, res, next) {
  if (!OPENAI_API_KEY || !VECTOR_STORE_ID) {
    return res.status(500).json({
      error: "OpenAI config is missing. Set OPENAI_API_KEY and OPENAI_VECTOR_STORE_ID in .env.",
    });
  }
  req.openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  return next();
}

app.post("/api/upload", requireOpenAI, upload.single("file"), async (req, res) => {
  const file = req.file;
  const category = req.body.category;

  if (!file) {
    return res.status(400).json({ error: "The file field is required." });
  }
  if (!["Basic", "Web", "Mobile"].includes(category)) {
    fs.unlink(file.path, () => {});
    return res.status(400).json({ error: "Category must be one of Basic/Web/Mobile." });
  }

  try {
    const uploaded = await req.openai.files.create({
      file: fs.createReadStream(file.path),
      purpose: "assistants",
    });

    await req.openai.vectorStores.files.create(VECTOR_STORE_ID, {
      file_id: uploaded.id,
      attributes: {
        category,
        filename: file.originalname,
      },
    });

    upsertManifestItem({
      file_id: uploaded.id,
      filename: file.originalname,
      category,
      created_at: new Date().toISOString(),
    });

    return res.json({
      ok: true,
      file_id: uploaded.id,
      filename: file.originalname,
      category,
    });
  } catch (err) {
    return res.status(500).json({
      error: "OpenAI upload failed",
      detail: err?.message || String(err),
    });
  } finally {
    fs.unlink(file.path, () => {});
  }
});

app.post("/api/search", requireOpenAI, async (req, res) => {
  const query = String(req.body.query || "").trim();
  const category = String(req.body.category || "").trim();
  const maxResults = Math.max(1, Math.min(Number(req.body.max_results || 50), 50));

  if (!query) {
    return res.status(400).json({ error: "Query is required." });
  }
  if (!["Basic", "Web", "Mobile"].includes(category)) {
    return res.status(400).json({ error: "Category must be one of Basic/Web/Mobile." });
  }

  try {
    const response = await req.openai.responses.create({
      model: SEARCH_MODEL,
      input: query,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [VECTOR_STORE_ID],
          max_num_results: maxResults,
        },
      ],
      include: ["file_search_call.results"],
    });

    const manifest = readManifest();
    const allowed = new Set(
      manifest.filter((row) => row.category === category).map((row) => row.file_id),
    );

    const results = extractFileSearchResults(response)
      .filter((row) => allowed.has(row.file_id))
      .map((row) => {
        const meta = manifest.find((m) => m.file_id === row.file_id);
        return {
          ...row,
          filename: row.filename || meta?.filename || "Unknown file",
        };
      });

    return res.json({ ok: true, results });
  } catch (err) {
    return res.status(500).json({
      error: "OpenAI search failed",
      detail: err?.message || String(err),
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (!err) return next();

  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "File size limit exceeded (100MB)." });
  }

  if (err.name === "MulterError") {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }

  if (req.path.startsWith("/api/")) {
    return res.status(500).json({
      error: "Server error",
      detail: err?.message || String(err),
    });
  }

  return next(err);
});

app.use(express.static(__dirname));

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
