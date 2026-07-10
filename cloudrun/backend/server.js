import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 8080);
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const localMemory = new Map();

const server = http.createServer(async (req, res) => {
  try {
    setCors(res);

    if (req.method === "OPTIONS") {
      return send(res, 204, "");
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        firestore: Boolean(PROJECT_ID),
        gmailSync: hasGoogleOAuth(),
        calendarReminders: hasGoogleOAuth()
      });
    }

    if (url.pathname === "/api/jobs" && req.method === "GET") {
      const userId = requiredUser(url);
      return json(res, 200, { jobs: await listJobs(userId) });
    }

    if (url.pathname === "/api/jobs" && req.method === "POST") {
      const body = await readJson(req);
      const userId = sanitizeUserId(body.userId);
      const job = normalizeJob(body.job);
      await saveJob(userId, job);
      return json(res, 201, { job });
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch && req.method === "PATCH") {
      const body = await readJson(req);
      const userId = sanitizeUserId(body.userId);
      const job = normalizeJob({ ...body.job, id: decodeURIComponent(jobMatch[1]) });
      await saveJob(userId, job);
      return json(res, 200, { job });
    }

    if (jobMatch && req.method === "DELETE") {
      const userId = requiredUser(url);
      await deleteJob(userId, decodeURIComponent(jobMatch[1]));
      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/api/gmail/sync") {
      return json(res, 501, {
        ok: false,
        message: "Gmail sync needs Google OAuth client credentials and a user refresh token before production use."
      });
    }

    if (url.pathname === "/api/calendar/reminders") {
      return json(res, 501, {
        ok: false,
        message: "Calendar reminders need Google OAuth client credentials and a user refresh token before production use."
      });
    }

    return json(res, 404, { error: "Not found" });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`ApplyPilot backend listening on ${PORT}`);
});

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function send(res, status, body) {
  res.writeHead(status);
  res.end(body);
}

function json(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  send(res, status, JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(raw);
}

function requiredUser(url) {
  return sanitizeUserId(url.searchParams.get("userId"));
}

function sanitizeUserId(value) {
  const userId = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!userId) {
    const error = new Error("Missing userId");
    error.statusCode = 400;
    throw error;
  }
  return userId;
}

function normalizeJob(job) {
  const id = String(job?.id || randomUUID());
  return {
    id,
    company: String(job?.company || ""),
    role: String(job?.role || ""),
    location: String(job?.location || ""),
    url: String(job?.url || ""),
    status: String(job?.status || "Wishlist"),
    description: String(job?.description || ""),
    createdAt: String(job?.createdAt || new Date().toISOString()),
    followUpAt: String(job?.followUpAt || new Date().toISOString()),
    score: job?.score || { percent: 0, matched: [], missing: [], verdict: "Unscored" }
  };
}

async function listJobs(userId) {
  if (!PROJECT_ID) {
    return [...(localMemory.get(userId) || new Map()).values()];
  }

  const token = await getCloudAccessToken();
  const url = firestoreUrl(`users/${userId}/jobs`);
  const response = await fetch(url, { headers: authHeaders(token) });

  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Firestore list failed: ${response.status}`);

  const data = await response.json();
  return (data.documents || [])
    .map((doc) => JSON.parse(doc.fields?.payload?.stringValue || "{}"))
    .filter((job) => job.id);
}

async function saveJob(userId, job) {
  if (!PROJECT_ID) {
    if (!localMemory.has(userId)) localMemory.set(userId, new Map());
    localMemory.get(userId).set(job.id, job);
    return;
  }

  const token = await getCloudAccessToken();
  const response = await fetch(firestoreUrl(`users/${userId}/jobs/${job.id}`), {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        payload: { stringValue: JSON.stringify(job) },
        updatedAt: { timestampValue: new Date().toISOString() }
      }
    })
  });

  if (!response.ok) throw new Error(`Firestore save failed: ${response.status}`);
}

async function deleteJob(userId, jobId) {
  if (!PROJECT_ID) {
    localMemory.get(userId)?.delete(jobId);
    return;
  }

  const token = await getCloudAccessToken();
  const response = await fetch(firestoreUrl(`users/${userId}/jobs/${jobId}`), {
    method: "DELETE",
    headers: authHeaders(token)
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Firestore delete failed: ${response.status}`);
  }
}

function firestoreUrl(path) {
  return `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function getCloudAccessToken() {
  const response = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" }
  });

  if (!response.ok) throw new Error("Could not obtain Cloud Run service account token");
  const data = await response.json();
  return data.access_token;
}

function hasGoogleOAuth() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}
