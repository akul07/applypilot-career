const $ = (id) => document.getElementById(id);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const statusOrder = ["Wishlist", "Ready", "Applied", "Follow Up", "Interview", "Offer", "Rejected"];
const profileDefaults = {
  targetRole: "",
  targetLocations: "",
  workType: "Full-time",
  skills: "",
  name: "",
  email: "",
  phone: "",
  resumeLink: "",
  resumeSummary: "",
  defaultMail: ""
};

const state = {
  auth: null,
  db: null,
  user: null,
  profile: { ...profileDefaults },
  jobs: [],
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

function safeUrl(value) {
  const url = clean(value);
  return /^https?:\/\//i.test(url) ? url : "";
}

function setStatus(id, message) {
  const el = $(id);
  if (el) el.textContent = message || "";
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
    jobs: "Job Tracker",
    mail: "Apply Mail"
  };
  $("viewTitle").textContent = titles[view] || "Dashboard";
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
    if (form.elements[key]) form.elements[key].value = value || "";
  });
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  state.profile = { ...profileDefaults, ...data };
  await profileDoc().set({
    ...state.profile,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  setStatus("saveStatus", "Saved. Your dashboard and email drafts now use this profile.");
  renderAll();
}

async function addJob(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  await jobsCollection().add({
    company: clean(data.company),
    role: clean(data.role),
    email: clean(data.email),
    applyUrl: clean(data.applyUrl),
    location: clean(data.location),
    status: clean(data.status) || "Wishlist",
    followUpDate: clean(data.followUpDate),
    description: clean(data.description),
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

function jobScore(job) {
  const skills = skillList();
  const targetWords = clean(state.profile.targetRole).toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [job.role, job.description, job.company, job.location].join(" ").toLowerCase();
  if (!haystack || (!skills.length && !targetWords.length)) return 0;
  const skillHits = skills.filter((skill) => haystack.includes(skill)).length;
  const roleHits = targetWords.filter((word) => word.length > 2 && haystack.includes(word)).length;
  const skillPart = skills.length ? (skillHits / skills.length) * 70 : 0;
  const rolePart = targetWords.length ? Math.min(30, (roleHits / targetWords.length) * 30) : 0;
  return Math.min(98, Math.round(skillPart + rolePart));
}

function statusClass(status) {
  return clean(status).toLowerCase().replace(/\s+/g, "-");
}

function renderAll() {
  renderDashboard();
  renderJobs();
  renderMailOptions();
  refreshMailDraft();
}

function countByStatus(name) {
  return state.jobs.filter((job) => job.status === name).length;
}

function renderDashboard() {
  $("totalJobs").textContent = state.jobs.length;
  $("appliedJobs").textContent = countByStatus("Applied");
  $("interviewJobs").textContent = countByStatus("Interview");
  $("followUpJobs").textContent = countByStatus("Follow Up");
  $("goalTitle").textContent = state.profile.targetRole || "Add your target role";
  $("goalLocation").textContent = state.profile.targetLocations || "Not set";
  $("goalType").textContent = state.profile.workType || "Not set";
  $("goalSkills").textContent = state.profile.skills || "Not set";

  $("pipelineList").innerHTML = statusOrder.map((status) => `
    <div class="pipeline-row">
      <span>${escapeHtml(status)}</span>
      <strong>${countByStatus(status)}</strong>
    </div>
  `).join("");

  const recent = state.jobs.slice(0, 5);
  $("recentJobs").innerHTML = recent.length ? recent.map(renderJobCard).join("") : emptyState("No applications yet", "Add your first job to start tracking.");
}

function renderJobs() {
  const filter = $("statusFilter").value || "All";
  const jobs = filter === "All" ? state.jobs : state.jobs.filter((job) => job.status === filter);
  $("jobsList").innerHTML = jobs.length ? jobs.map(renderJobCard).join("") : emptyState("No jobs in this view", "Add an application or change the filter.");
}

function renderJobCard(job) {
  const score = jobScore(job);
  const url = safeUrl(job.applyUrl);
  const mailDisabled = job.email ? "" : " disabled";
  return `
    <article class="job-card" data-job-id="${job.id}">
      <div class="job-main">
        <div>
          <h3>${escapeHtml(job.role || "Untitled role")}</h3>
          <p>${escapeHtml(job.company || "Company not set")} ${job.location ? `- ${escapeHtml(job.location)}` : ""}</p>
        </div>
        <span class="score">${score}% match</span>
      </div>
      <div class="job-meta">
        <span class="pill ${statusClass(job.status)}">${escapeHtml(job.status || "Wishlist")}</span>
        ${job.followUpDate ? `<span>Follow up: ${escapeHtml(job.followUpDate)}</span>` : ""}
        ${job.email ? `<span>${escapeHtml(job.email)}</span>` : ""}
      </div>
      <div class="job-actions">
        <select data-action="status" data-id="${job.id}" aria-label="Update status">
          ${statusOrder.map((status) => `<option ${status === job.status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
        ${url ? `<a class="secondary link-button" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open link</a>` : ""}
        <button class="secondary" data-action="mail" data-id="${job.id}" type="button"${mailDisabled}>Mail</button>
        <button class="danger" data-action="delete" data-id="${job.id}" type="button">Delete</button>
      </div>
    </article>
  `;
}

function emptyState(title, body) {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span></div>`;
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
  const resumeLine = profile.resumeLink ? `\nResume: ${profile.resumeLink}` : "";
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
  setStatus("mailStatus", job.email ? "Ready. Review before sending." : "Add a recruiter or career email in the job tracker before opening a draft.");
}

async function copyMail() {
  const text = `Subject: ${$("mailSubject").value}\n\n${$("mailBody").value}`;
  await navigator.clipboard.writeText(text);
  setStatus("mailStatus", "Copied email subject and body.");
}

function openMailDraft() {
  const to = clean($("mailTo").value);
  if (!to) {
    setStatus("mailStatus", "Add the company email first.");
    return;
  }
  const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent($("mailSubject").value)}&body=${encodeURIComponent($("mailBody").value)}`;
  window.location.href = url;
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
  $("mailJobSelect").addEventListener("change", (event) => {
    state.selectedJobId = event.target.value;
    refreshMailDraft();
  });
  $("copyMailBtn").addEventListener("click", copyMail);
  $("openMailBtn").addEventListener("click", openMailDraft);
  $("quickAddBtn").addEventListener("click", () => goView("jobs"));

  $$(".nav-item").forEach((button) => button.addEventListener("click", () => goView(button.dataset.view)));
  $$('[data-go-view]').forEach((button) => button.addEventListener("click", () => goView(button.dataset.goView)));

  document.addEventListener("click", async (event) => {
    const action = event.target.dataset.action;
    const id = event.target.dataset.id;
    if (!action || !id) return;
    if (action === "mail") {
      state.selectedJobId = id;
      goView("mail");
    }
    if (action === "delete") await deleteJob(id);
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
