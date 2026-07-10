const $ = (id) => document.getElementById(id);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const statusOrder = ["Wishlist", "Ready", "Applied", "Follow Up", "Interview", "Offer", "Rejected"];
const resumeLimitBytes = 650 * 1024;
const profileDefaults = {
  targetRole: "",
  targetLocations: "",
  workType: "Full-time",
  skills: "",
  name: "",
  email: "",
  phone: "",
  resumeSummary: "",
  resumeFileName: "",
  resumeFileType: "",
  resumeFileSize: 0,
  resumeDataUrl: "",
  resumeText: "",
  defaultMail: ""
};

const state = {
  auth: null,
  db: null,
  user: null,
  profile: { ...profileDefaults },
  jobs: [],
  discoveredJobs: [],
  selectedJobId: "",
  unsubscribeJobs: null
};

function initFirebase() {
  const cfg = window.APPLYPILOT_CONFIG && window.APPLYPILOT_CONFIG.firebaseConfig;
  if (!cfg || !cfg.projectId) {
    $("authStatus").textContent = "Firebase config missing. Check app-config.js.";
    return false;
  }
  if (!firebase.apps.length) firebase.initializeApp(cfg);
  state.auth = firebase.auth();
  state.db = firebase.firestore();
  return true;
}

function userRoot() {
  return state.db.collection("users").doc(state.user.uid);
}

function profileDoc() {
  return userRoot().collection("profile").doc("main");
}

function jobsCollection() {
  return userRoot().collection("jobs");
}

function clean(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stripHtml(value) {
  const div = document.createElement("div");
  div.innerHTML = String(value || "");
  return clean(div.textContent || div.innerText || value);
}

function safeUrl(value) {
  const url = clean(value);
  return /^https?:\/\//i.test(url) ? url : "";
}

function setStatus(id, message) {
  const el = $(id);
  if (el) el.textContent = message || "";
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!size) return "0 KB";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function showAuth(user) {
  state.user = user || null;
  $("authView").classList.toggle("hidden", Boolean(user));
  $("appView").classList.toggle("hidden", !user);
  if (user) $("userEmail").textContent = user.email || "Signed in";
}

function goView(view) {
  $$(".view").forEach((el) => el.classList.toggle("active", el.id === `${view}View`));
  $$(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  const titles = {
    dashboard: "Dashboard",
    setup: "Goal + Resume",
    discover: "Discover Jobs",
    jobs: "Job Tracker",
    mail: "Apply Mail"
  };
  $("viewTitle").textContent = titles[view] || "Dashboard";
  if (view === "discover") renderDiscover();
  if (view === "mail") refreshMailDraft();
}

async function loadProfile() {
  const snap = await profileDoc().get();
  state.profile = { ...profileDefaults, ...(snap.exists ? snap.data() : {}) };
  fillProfileForm();
  renderAll();
}

function watchJobs() {
  if (state.unsubscribeJobs) state.unsubscribeJobs();
  state.unsubscribeJobs = jobsCollection().orderBy("createdAt", "desc").onSnapshot((snap) => {
    state.jobs = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    if (!state.selectedJobId && state.jobs.length) state.selectedJobId = state.jobs[0].id;
    renderAll();
  }, (error) => {
    console.error(error);
    setStatus("saveStatus", "Could not load jobs. Check Firestore rules.");
  });
}

function fillProfileForm() {
  const form = $("profileForm");
  Object.entries(state.profile).forEach(([key, value]) => {
    if (form.elements[key] && form.elements[key].type !== "file") form.elements[key].value = value || "";
  });
  updateResumeStatus();
}

function updateResumeStatus(message) {
  const resume = state.profile;
  const status = $("resumeStatus");
  if (!status) return;
  if (message) {
    status.textContent = message;
    return;
  }
  if (!resume.resumeFileName) {
    status.textContent = "No resume uploaded";
    return;
  }
  const saved = resume.resumeDataUrl ? "saved" : "name saved";
  status.textContent = `${resume.resumeFileName} (${formatBytes(resume.resumeFileSize)}) - ${saved}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function resumePatchFromFile(file) {
  if (!file || !file.name) return {};
  const patch = {
    resumeFileName: file.name,
    resumeFileType: file.type || "application/octet-stream",
    resumeFileSize: file.size,
    resumeSavedAt: new Date().toISOString()
  };
  if (file.size > resumeLimitBytes) {
    updateResumeStatus(`${file.name} is large, so only the file name was saved. Paste summary for matching.`);
    return { ...patch, resumeDataUrl: "" };
  }
  const dataUrl = await readFileAsDataUrl(file);
  const text = file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt") ? await file.text() : state.profile.resumeText || "";
  return { ...patch, resumeDataUrl: dataUrl, resumeText: text };
}

function preservedResumeFields() {
  return {
    resumeFileName: state.profile.resumeFileName || "",
    resumeFileType: state.profile.resumeFileType || "",
    resumeFileSize: state.profile.resumeFileSize || 0,
    resumeDataUrl: state.profile.resumeDataUrl || "",
    resumeText: state.profile.resumeText || "",
    resumeSavedAt: state.profile.resumeSavedAt || ""
  };
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  delete data.resumeFile;
  const file = form.elements.resumeFile.files[0];
  const resumePatch = await resumePatchFromFile(file);
  state.profile = { ...profileDefaults, ...preservedResumeFields(), ...data, ...resumePatch };
  await profileDoc().set({
    ...state.profile,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  form.elements.resumeFile.value = "";
  updateResumeStatus();
  setStatus("saveStatus", "Saved. Compatibility, discovery, and mail drafts now use this profile.");
  renderAll();
}

async function addJob(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const baseJob = {
    company: clean(data.company),
    role: clean(data.role),
    email: clean(data.email),
    applyUrl: clean(data.applyUrl),
    location: clean(data.location),
    status: clean(data.status) || "Wishlist",
    followUpDate: clean(data.followUpDate),
    description: clean(data.description)
  };
  const fit = compatibilityScore(baseJob);
  await jobsCollection().add({
    ...baseJob,
    matchScore: fit.score,
    matchReasons: fit.reasons,
    mailStatus: baseJob.email ? "Draft ready" : "Need email",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  form.reset();
  form.elements.status.value = "Wishlist";
  goView("jobs");
}

async function updateJob(id, patch) {
  await jobsCollection().doc(id).set({
    ...patch,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function deleteJob(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return;
  if (!window.confirm(`Delete ${job.company || "this job"} from your tracker?`)) return;
  await jobsCollection().doc(id).delete();
  if (state.selectedJobId === id) state.selectedJobId = "";
}

function skillList() {
  return clean(state.profile.skills)
    .split(/[\n,;]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function wordList(value) {
  return clean(value).toLowerCase().split(/[^a-z0-9+#.]+/).filter((word) => word.length > 2);
}

function includesTerm(haystack, term) {
  const value = clean(term).toLowerCase();
  if (!value) return false;
  return haystack.includes(value);
}

function topResumeKeywords() {
  const stop = new Set(["and", "the", "for", "with", "from", "this", "that", "have", "has", "you", "your", "are", "was", "were", "will", "project", "projects", "experience", "using", "built"]);
  const text = `${state.profile.resumeSummary || ""} ${state.profile.resumeText || ""}`;
  const counts = new Map();
  wordList(text).forEach((word) => {
    if (!stop.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([word]) => word);
}

function compatibilityScore(job) {
  const skills = skillList();
  const roleWords = wordList(state.profile.targetRole);
  const locationWords = wordList(state.profile.targetLocations);
  const resumeWords = topResumeKeywords();
  const haystack = stripHtml([job.role, job.title, job.description, job.company, job.location, job.source].join(" ")).toLowerCase();
  if (!haystack || (!skills.length && !roleWords.length)) return { score: 0, reasons: ["Add goal and skills"] };

  const skillHits = skills.filter((skill) => includesTerm(haystack, skill));
  const roleHits = roleWords.filter((word) => includesTerm(haystack, word));
  const locationHits = locationWords.filter((word) => includesTerm(haystack, word));
  const resumeHits = resumeWords.filter((word) => includesTerm(haystack, word));
  const skillPart = skills.length ? (skillHits.length / skills.length) * 55 : 0;
  const rolePart = roleWords.length ? (roleHits.length / roleWords.length) * 25 : 0;
  const locationPart = locationWords.length ? Math.min(10, (locationHits.length / locationWords.length) * 10) : 7;
  const resumePart = resumeWords.length ? Math.min(10, (resumeHits.length / Math.min(resumeWords.length, 8)) * 10) : 5;
  const score = Math.min(99, Math.round(skillPart + rolePart + locationPart + resumePart));
  const reasons = [];
  if (skillHits.length) reasons.push(`Skills: ${skillHits.slice(0, 5).join(", ")}`);
  if (roleHits.length) reasons.push("Role match");
  if (locationHits.length || !locationWords.length) reasons.push("Location fit");
  if (resumeHits.length) reasons.push(`Resume keywords: ${resumeHits.slice(0, 4).join(", ")}`);
  return { score, reasons: reasons.length ? reasons : ["Low overlap"] };
}

function jobScore(job) {
  return compatibilityScore(job).score;
}

function statusClass(status) {
  return clean(status).toLowerCase().replace(/\s+/g, "-");
}

function renderAll() {
  renderDashboard();
  renderJobs();
  renderDiscover();
  renderMailOptions();
  refreshMailDraft();
}

function countByStatus(name) {
  return state.jobs.filter((job) => job.status === name).length;
}

function renderDashboard() {
  const matching = state.jobs.filter((job) => jobScore(job) >= 90).length;
  const mailReady = state.jobs.filter((job) => job.email || ["Draft ready", "Draft opened", "Sent manually"].includes(job.mailStatus)).length;
  $("totalJobs").textContent = state.jobs.length;
  $("matchedJobs").textContent = matching;
  $("appliedJobs").textContent = countByStatus("Applied");
  $("interviewJobs").textContent = countByStatus("Interview");
  $("mailReadyJobs").textContent = mailReady;
  $("goalTitle").textContent = state.profile.targetRole || "Add your target role";
  $("goalLocation").textContent = state.profile.targetLocations || "Not set";
  $("goalType").textContent = state.profile.workType || "Not set";
  $("goalSkills").textContent = state.profile.skills || "Not set";
  $("goalResume").textContent = state.profile.resumeFileName || "Not uploaded";

  $("pipelineList").innerHTML = statusOrder.map((status) => `
    <div class="pipeline-row"><span>${escapeHtml(status)}</span><strong>${countByStatus(status)}</strong></div>
  `).join("");

  const recent = state.jobs.slice(0, 5);
  $("recentJobs").innerHTML = recent.length ? recent.map(renderJobCard).join("") : emptyState("No applications yet", "Use Discover Jobs to find your first 90% match.");
  renderMailTracker();
}

function renderMailTracker() {
  const list = $("mailTrackerList");
  const mailJobs = state.jobs.filter((job) => job.email || job.mailStatus || job.status === "Applied").slice(0, 6);
  list.innerHTML = mailJobs.length ? mailJobs.map((job) => `
    <article class="mail-row">
      <div>
        <strong>${escapeHtml(job.company || "Company")}</strong>
        <span>${escapeHtml(job.role || "Role")} - ${escapeHtml(job.mailStatus || "Need email")}</span>
      </div>
      <div class="button-row">
        <button class="secondary small" data-action="mail" data-id="${job.id}" type="button">Draft</button>
        <button class="secondary small" data-action="mark-sent" data-id="${job.id}" type="button">Sent</button>
      </div>
    </article>
  `).join("") : emptyState("No mail activity yet", "Saved jobs with emails will appear here.");
}

function renderJobs() {
  const filter = $("statusFilter").value || "All";
  const jobs = filter === "All" ? state.jobs : state.jobs.filter((job) => job.status === filter);
  $("jobsList").innerHTML = jobs.length ? jobs.map(renderJobCard).join("") : emptyState("No jobs in this view", "Find a match or change the filter.");
}

function renderJobCard(job) {
  const fit = compatibilityScore(job);
  const url = safeUrl(job.applyUrl);
  return `
    <article class="job-card" data-job-id="${job.id}">
      <div class="job-main">
        <div>
          <h3>${escapeHtml(job.role || "Untitled role")}</h3>
          <p>${escapeHtml(job.company || "Company not set")} ${job.location ? `- ${escapeHtml(job.location)}` : ""}</p>
        </div>
        <span class="score ${fit.score >= 90 ? "strong-score" : ""}">${fit.score}% match</span>
      </div>
      <div class="job-meta">
        <span class="pill ${statusClass(job.status)}">${escapeHtml(job.status || "Wishlist")}</span>
        <span>${escapeHtml(job.mailStatus || (job.email ? "Draft ready" : "Need email"))}</span>
        ${job.followUpDate ? `<span>Follow up: ${escapeHtml(job.followUpDate)}</span>` : ""}
        ${job.email ? `<span>${escapeHtml(job.email)}</span>` : ""}
      </div>
      <p class="match-reasons">${escapeHtml(fit.reasons.join(" | "))}</p>
      <div class="job-actions">
        <select data-action="status" data-id="${job.id}" aria-label="Update status">
          ${statusOrder.map((status) => `<option ${status === job.status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
        ${url ? `<a class="secondary link-button" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open job</a>` : ""}
        <button class="secondary" data-action="mail" data-id="${job.id}" type="button">Mail</button>
        <button class="danger" data-action="delete" data-id="${job.id}" type="button">Delete</button>
      </div>
    </article>
  `;
}

function emptyState(title, body) {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span></div>`;
}

function searchTerms() {
  const skills = skillList();
  return [state.profile.targetRole, skills.slice(0, 4).join(" "), state.profile.targetLocations]
    .map(clean)
    .filter(Boolean);
}

function renderSearchSummary() {
  const summary = $("searchSummary");
  if (!summary) return;
  const terms = searchTerms();
  summary.innerHTML = terms.length ? terms.map((term) => `<span>${escapeHtml(term)}</span>`).join("") : `<span>Add goal and skills first</span>`;
}

function normalizeRemoteJobs(data) {
  const remotive = (data.remotive && data.remotive.jobs) || [];
  const arbeitnow = (data.arbeitnow && data.arbeitnow.data) || [];
  const jobs = [];
  remotive.forEach((job) => jobs.push({
    source: "Remotive",
    company: clean(job.company_name),
    role: clean(job.title),
    location: clean(job.candidate_required_location || "Remote"),
    description: stripHtml(job.description),
    applyUrl: clean(job.url),
    tags: Array.isArray(job.tags) ? job.tags.join(", ") : ""
  }));
  arbeitnow.forEach((job) => jobs.push({
    source: "Arbeitnow",
    company: clean(job.company_name),
    role: clean(job.title),
    location: clean(job.location || (job.remote ? "Remote" : "")),
    description: stripHtml(job.description),
    applyUrl: clean(job.url),
    tags: Array.isArray(job.tags) ? job.tags.join(", ") : ""
  }));
  const seen = new Set();
  return jobs.filter((job) => {
    const key = job.applyUrl || `${job.company}-${job.role}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return job.role && job.company && job.description;
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

async function findJobs() {
  const terms = searchTerms();
  const minMatch = Number($("minMatchSelect").value || 90);
  if (!terms.length) {
    setStatus("discoverStatus", "Add your job goal and skills first.");
    goView("setup");
    return;
  }
  setStatus("discoverStatus", "Searching public job feeds...");
  $("findJobsBtn").disabled = true;
  renderSearchSummary();
  try {
    const query = encodeURIComponent(terms.slice(0, 2).join(" "));
    const [remotiveResult, arbeitnowResult] = await Promise.allSettled([
      fetchJson(`https://remotive.com/api/remote-jobs?search=${query}`),
      fetchJson("https://www.arbeitnow.com/api/job-board-api")
    ]);
    const data = {
      remotive: remotiveResult.status === "fulfilled" ? remotiveResult.value : null,
      arbeitnow: arbeitnowResult.status === "fulfilled" ? arbeitnowResult.value : null
    };
    const normalized = normalizeRemoteJobs(data);
    state.discoveredJobs = normalized.map((job) => {
      const fit = compatibilityScore(job);
      return { ...job, matchScore: fit.score, matchReasons: fit.reasons };
    }).filter((job) => job.matchScore >= minMatch)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 30);
    setStatus("discoverStatus", `${state.discoveredJobs.length} jobs matched at ${minMatch}% or higher.`);
    renderDiscover();
  } catch (error) {
    console.error(error);
    setStatus("discoverStatus", "Job search failed. Try again in a minute.");
  } finally {
    $("findJobsBtn").disabled = false;
  }
}

function renderDiscover() {
  renderSearchSummary();
  const list = $("discoveryList");
  if (!list) return;
  if (!state.discoveredJobs.length) {
    list.innerHTML = emptyState("No matched jobs loaded", "Run Find matches after saving your goal and resume.");
    return;
  }
  list.innerHTML = state.discoveredJobs.map((job, index) => `
    <article class="discovery-card">
      <div class="job-main">
        <div>
          <p class="eyebrow">${escapeHtml(job.source)}</p>
          <h3>${escapeHtml(job.role)}</h3>
          <p>${escapeHtml(job.company)} ${job.location ? `- ${escapeHtml(job.location)}` : ""}</p>
        </div>
        <span class="score strong-score">${job.matchScore}% match</span>
      </div>
      <p class="match-reasons">${escapeHtml(job.matchReasons.join(" | "))}</p>
      <p class="description-preview">${escapeHtml(job.description.slice(0, 260))}${job.description.length > 260 ? "..." : ""}</p>
      <div class="job-actions">
        <a class="secondary link-button" href="${escapeHtml(job.applyUrl)}" target="_blank" rel="noreferrer">Open job</a>
        <button class="primary" data-action="save-discovery" data-index="${index}" type="button">Save to tracker</button>
      </div>
    </article>
  `).join("");
}

async function saveDiscoveredJob(index) {
  const job = state.discoveredJobs[Number(index)];
  if (!job) return;
  await jobsCollection().add({
    company: job.company,
    role: job.role,
    email: "",
    applyUrl: job.applyUrl,
    location: job.location,
    status: "Wishlist",
    followUpDate: "",
    description: job.description,
    source: job.source,
    matchScore: job.matchScore,
    matchReasons: job.matchReasons,
    mailStatus: "Need email",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  setStatus("discoverStatus", `${job.company} saved to tracker.`);
}

function renderMailOptions() {
  const select = $("mailJobSelect");
  const current = state.selectedJobId;
  select.innerHTML = state.jobs.length
    ? state.jobs.map((job) => `<option value="${job.id}" ${job.id === current ? "selected" : ""}>${escapeHtml(job.company || "Company")} - ${escapeHtml(job.role || "Role")}</option>`).join("")
    : `<option value="">No jobs added</option>`;
  if (current && state.jobs.some((job) => job.id === current)) select.value = current;
}

function selectedJob() {
  return state.jobs.find((job) => job.id === state.selectedJobId) || state.jobs[0] || null;
}

function buildMail(job) {
  const profile = state.profile;
  const role = job && job.role ? job.role : profile.targetRole || "the role";
  const company = job && job.company ? job.company : "your company";
  const subject = `Application for ${role} - ${profile.name || "Candidate"}`;
  const intro = profile.defaultMail || `Hi Hiring Team,\n\nI am interested in the ${role} opportunity at ${company}. My background matches this role, and I would like to share my profile for your review.`;
  const resumeLine = profile.resumeFileName ? `\nResume: ${profile.resumeFileName} (attached manually)` : "";
  const phoneLine = profile.phone ? `\nPhone: ${profile.phone}` : "";
  const summary = profile.resumeSummary ? `\n\nShort profile:\n${profile.resumeSummary}` : "";
  const body = `${intro}${summary}${resumeLine}${phoneLine}\n\nRegards,\n${profile.name || ""}\n${profile.email || ""}`.trim();
  return { subject, body };
}

function refreshMailDraft() {
  const job = selectedJob();
  if (!job) {
    $("mailTo").value = "";
    $("mailSubject").value = "";
    $("mailBody").value = "";
    setStatus("mailStatus", "Add a job first, then this page will prepare your email draft.");
    return;
  }
  state.selectedJobId = job.id;
  const draft = buildMail(job);
  $("mailTo").value = job.email || "";
  $("mailSubject").value = draft.subject;
  $("mailBody").value = draft.body;
  setStatus("mailStatus", job.email ? "Ready. Review before sending." : "Add a recruiter or career email, then open the draft.");
}

async function copyMail() {
  const text = `Subject: ${$("mailSubject").value}\n\n${$("mailBody").value}`;
  await navigator.clipboard.writeText(text);
  setStatus("mailStatus", "Copied email subject and body.");
}

async function openMailDraft() {
  const job = selectedJob();
  const to = clean($("mailTo").value);
  if (!job || !to) {
    setStatus("mailStatus", "Add the company email first.");
    return;
  }
  await updateJob(job.id, {
    email: to,
    mailStatus: "Draft opened",
    lastMailAt: new Date().toISOString()
  });
  const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent($("mailSubject").value)}&body=${encodeURIComponent($("mailBody").value)}`;
  window.location.href = url;
}

async function markSelectedSent() {
  const job = selectedJob();
  if (!job) return;
  await updateJob(job.id, {
    email: clean($("mailTo").value) || job.email || "",
    status: "Applied",
    mailStatus: "Sent manually",
    lastMailAt: new Date().toISOString()
  });
  setStatus("mailStatus", "Marked as sent and moved to Applied.");
}

function bindEvents() {
  $("googleBtn").addEventListener("click", async () => {
    try {
      setStatus("authStatus", "Opening Google sign in...");
      const provider = new firebase.auth.GoogleAuthProvider();
      await state.auth.signInWithPopup(provider);
    } catch (error) {
      console.error(error);
      setStatus("authStatus", error.message || "Google sign in failed.");
    }
  });

  $("signOutBtn").addEventListener("click", () => state.auth.signOut());
  $("profileForm").addEventListener("submit", saveProfile);
  $("jobForm").addEventListener("submit", addJob);
  $("statusFilter").addEventListener("change", renderJobs);
  $("findJobsBtn").addEventListener("click", findJobs);
  $("minMatchSelect").addEventListener("change", findJobs);
  $("mailJobSelect").addEventListener("change", (event) => {
    state.selectedJobId = event.target.value;
    refreshMailDraft();
  });
  $("copyMailBtn").addEventListener("click", copyMail);
  $("openMailBtn").addEventListener("click", openMailDraft);
  $("markSentBtn").addEventListener("click", markSelectedSent);
  $("quickAddBtn").addEventListener("click", () => goView("discover"));

  $$(".nav-item").forEach((button) => button.addEventListener("click", () => goView(button.dataset.view)));
  $$('[data-go-view]').forEach((button) => button.addEventListener("click", () => goView(button.dataset.goView)));

  document.addEventListener("click", async (event) => {
    const action = event.target.dataset.action;
    if (!action) return;
    const id = event.target.dataset.id;
    if (action === "mail" && id) {
      state.selectedJobId = id;
      goView("mail");
    }
    if (action === "delete" && id) await deleteJob(id);
    if (action === "mark-sent" && id) await updateJob(id, { status: "Applied", mailStatus: "Sent manually", lastMailAt: new Date().toISOString() });
    if (action === "save-discovery") await saveDiscoveredJob(event.target.dataset.index);
  });

  document.addEventListener("change", async (event) => {
    if (event.target.dataset.action === "status") {
      await updateJob(event.target.dataset.id, { status: event.target.value });
    }
  });
}

function start() {
  bindEvents();
  if (!initFirebase()) return;
  state.auth.onAuthStateChanged(async (user) => {
    showAuth(user);
    if (!user) {
      if (state.unsubscribeJobs) state.unsubscribeJobs();
      state.profile = { ...profileDefaults };
      state.jobs = [];
      state.discoveredJobs = [];
      return;
    }
    try {
      await loadProfile();
      watchJobs();
      goView("dashboard");
    } catch (error) {
      console.error(error);
      setStatus("saveStatus", "Could not load your workspace. Check Firebase setup.");
    }
  });
}

start();
