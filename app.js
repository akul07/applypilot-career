const config = window.APPLYPILOT_CONFIG || {};

const defaultProfile = {
  name: "",
  title: "",
  email: "",
  phone: "",
  location: "",
  linkedin: "",
  skills: [],
  domains: [],
  highlights: [],
  resumeText: "",
  setupComplete: false,
  goals: {
    targetRole: "",
    experienceLevel: "Fresher",
    jobType: "Full-time",
    workMode: "Remote",
    startTimeline: "Immediately",
    locations: "",
    salaryRange: "",
    prioritySkills: [],
    preferredCompanies: "",
    jobBoards: ""
  },
  auth: {
    email: "",
    displayName: "",
    provider: "",
    lastLoginAt: ""
  }
};


const state = {
  profile: normalizeProfile(defaultProfile),
  jobs: [],
  filter: "All",
  selectedKitJobId: null,
  uid: null,
  user: null,
  db: null,
  unsubJobs: null,
  cloud: {
    enabled: false,
    status: "Login required",
    detail: "Sign in to save data to Firestore."
  }
};

const views = {
  setup: document.querySelector("#setupView"),
  dashboard: document.querySelector("#dashboardView"),
  jobs: document.querySelector("#jobsView"),
  match: document.querySelector("#matchView"),
  kit: document.querySelector("#kitView"),
  profile: document.querySelector("#profileView")
};

const titles = {
  setup: "Job Goals",
  dashboard: "Dashboard",
  jobs: "Job Tracker",
  match: "Resume Match",
  kit: "Apply Kit",
  profile: "Resume Profile"
};

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  renderAll();
  await initFirebase();
});

function bindEvents() {
  document.querySelectorAll("[data-view], [data-view-jump]").forEach((control) => {
    control.addEventListener("click", () => switchView(control.dataset.view || control.dataset.viewJump));
  });

  document.querySelector("#googleSignInBtn").addEventListener("click", signInWithGoogle);
  document.querySelector("#emailAuthForm").addEventListener("submit", handleEmailAuth);
  document.querySelector("#signOutBtn").addEventListener("click", signOut);

  document.querySelector("#setupForm").addEventListener("submit", saveSetup);
  document.querySelector("#profileForm").addEventListener("submit", saveProfile);
  document.querySelector("#jobForm").addEventListener("submit", saveJob);
  document.querySelector("#statusFilter").addEventListener("change", (event) => {
    state.filter = event.target.value;
    renderJobs();
  });
  document.querySelector("#labScoreBtn").addEventListener("click", scoreLabDescription);
  document.querySelector("#kitJobSelect").addEventListener("change", (event) => {
    state.selectedKitJobId = event.target.value;
    renderKit();
  });
  document.querySelector("#copyMessageBtn").addEventListener("click", copyMessage);
  document.querySelector("#themeBtn").addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem("applyPilotTheme", document.body.classList.contains("dark") ? "dark" : "light");
  });

  if (localStorage.getItem("applyPilotTheme") === "dark") {
    document.body.classList.add("dark");
  }
}

async function initFirebase() {
  try {
    if (!config.firebaseConfig || !window.firebase) throw new Error("Firebase SDK is not available");
    if (!firebase.apps.length) firebase.initializeApp(config.firebaseConfig);
    state.db = firebase.firestore();
    firebase.auth().onAuthStateChanged((user) => handleAuthState(user));
  } catch (error) {
    setAuthStatus("Firebase could not start. Check app config and internet connection.");
    setCloudStatus("Offline", "Firebase SDK did not initialize.");
  }
}

async function handleAuthState(user) {
  if (!user) {
    state.user = null;
    state.uid = null;
    state.cloud.enabled = false;
    state.profile = normalizeProfile(defaultProfile);
    state.jobs = [];
    document.body.classList.add("auth-required");
    document.body.classList.remove("signed-in");
    setAuthStatus("");
    setCloudStatus("Login required", "Sign in to save data to Firestore.");
    renderAll();
    return;
  }

  state.user = user;
  state.uid = user.uid;
  state.cloud.enabled = true;
  document.body.classList.remove("auth-required");
  document.body.classList.add("signed-in");
  setAuthStatus("Signed in.");
  setCloudStatus("Firestore", "Loading your saved profile and applications.");

  await loadUserProfile();
  watchJobs();
  switchView(state.profile.setupComplete ? "dashboard" : "setup");
}

async function signInWithGoogle() {
  try {
    setAuthStatus("Opening Google sign-in...");
    const provider = new firebase.auth.GoogleAuthProvider();
    await firebase.auth().signInWithPopup(provider);
  } catch (error) {
    setAuthStatus(readableAuthError(error));
  }
}

async function handleEmailAuth(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");
  try {
    setAuthStatus("Signing in...");
    await firebase.auth().signInWithEmailAndPassword(email, password);
  } catch (error) {
    setAuthStatus(readableAuthError(error));
  }
}

async function signOut() {
  if (state.unsubJobs) state.unsubJobs();
  await firebase.auth().signOut();
}

function profileRef() {
  return state.db.collection("users").doc(state.uid).collection("profile").doc("main");
}

function jobRef(id) {
  return state.db.collection("users").doc(state.uid).collection("jobs").doc(id);
}

async function loadUserProfile() {
  const localProfile = loadLocalProfile();
  const doc = await profileRef().get();
  const base = doc.exists ? doc.data() : localProfile;
  state.profile = normalizeProfile({
    ...base,
    email: base.email || state.user.email || "",
    name: base.name || state.user.displayName || "",
    auth: {
      ...(base.auth || {}),
      email: state.user.email || "",
      displayName: state.user.displayName || "",
      provider: state.user.providerData?.[0]?.providerId || "password",
      lastLoginAt: new Date().toISOString()
    }
  });
  await profileRef().set(state.profile, { merge: true });
  persistLocal();
  hydrateSetupForm();
  hydrateProfileForm();
  renderAll();
  setCloudStatus("Firestore", "Profile is saved in Firestore.");
}

function watchJobs() {
  if (state.unsubJobs) state.unsubJobs();
  state.unsubJobs = state.db
    .collection("users")
    .doc(state.uid)
    .collection("jobs")
    .orderBy("createdAt", "desc")
    .onSnapshot(
      (snapshot) => {
        state.jobs = snapshot.docs.map((doc) => withScore({ id: doc.id, ...doc.data() }));
        persistLocal();
        renderAll();
      },
      () => setCloudStatus("Rules needed", "Deploy Firestore rules and enable Auth providers, then reload.")
    );
}

function loadLocalProfile() {
  try {
    return normalizeProfile(JSON.parse(localStorage.getItem(localKey("profile")) || "null") || defaultProfile);
  } catch {
    return normalizeProfile(defaultProfile);
  }
}

function persistLocal() {
  localStorage.setItem(localKey("profile"), JSON.stringify(state.profile));
  localStorage.setItem(localKey("jobs"), JSON.stringify(state.jobs));
}

function localKey(name) {
  return `applyPilot:${state.uid || "guest"}:${name}`;
}

function normalizeProfile(profile) {
  const goals = { ...defaultProfile.goals, ...(profile?.goals || {}) };
  return {
    ...defaultProfile,
    ...profile,
    goals: {
      ...goals,
      prioritySkills: asList(goals.prioritySkills)
    },
    skills: asList(profile?.skills || defaultProfile.skills),
    domains: asList(profile?.domains || defaultProfile.domains),
    highlights: asList(profile?.highlights || defaultProfile.highlights),
    resumeText: String(profile?.resumeText || "")
  };
}

function withScore(job) {
  return { ...job, score: job.score || scoreJob(job.description || "") };
}

function renderAll() {
  renderProfileSummary();
  renderCloudStatus();
  renderMetrics();
  renderPriority();
  renderPipeline();
  renderJobs();
  renderKitOptions();
  renderKit();
}

function renderProfileSummary() {
  const displayName = state.profile.name || state.user?.displayName || "Candidate";
  const target = state.profile.goals?.targetRole || state.profile.title || "Set job goals first";
  document.querySelector("#profileName").textContent = displayName;
  document.querySelector("#profileTitle").textContent = target;
  document.querySelector("#authUserEmail").textContent = state.user?.email || "Not signed in";
  const chips = [...asList(state.profile.goals?.prioritySkills), ...state.profile.skills].slice(0, 12);
  document.querySelector("#skillChips").innerHTML = chips.map(chip).join("");
}

function hydrateSetupForm() {
  const form = document.querySelector("#setupForm");
  if (!form) return;
  const goals = state.profile.goals || defaultProfile.goals;
  form.targetRole.value = goals.targetRole || "";
  form.experienceLevel.value = goals.experienceLevel || "Fresher";
  form.jobType.value = goals.jobType || "Full-time";
  form.workMode.value = goals.workMode || "Remote";
  form.startTimeline.value = goals.startTimeline || "Immediately";
  form.locations.value = goals.locations || "";
  form.salaryRange.value = goals.salaryRange || "";
  form.prioritySkills.value = asList(goals.prioritySkills).join(", ");
  form.preferredCompanies.value = goals.preferredCompanies || "";
  form.jobBoards.value = goals.jobBoards || "";
}

function hydrateProfileForm() {
  const form = document.querySelector("#profileForm");
  if (!form) return;
  form.name.value = state.profile.name || state.user?.displayName || "";
  form.title.value = state.profile.title || state.profile.goals?.targetRole || "";
  form.email.value = state.profile.email || state.user?.email || "";
  form.phone.value = state.profile.phone || "";
  form.location.value = state.profile.location || state.profile.goals?.locations || "";
  form.linkedin.value = state.profile.linkedin || "";
  form.skills.value = state.profile.skills.join(", ");
  form.domains.value = state.profile.domains.join(", ");
  form.resumeText.value = state.profile.resumeText || "";
  form.highlights.value = state.profile.highlights.join("\n");
}

function switchView(viewName) {
  Object.values(views).forEach((view) => view.classList.remove("active"));
  views[viewName].classList.add("active");
  document.querySelector("#viewTitle").textContent = titles[viewName];
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewName));
}

async function saveSetup(event) {
  event.preventDefault();
  requireLogin();
  const form = new FormData(event.currentTarget);
  state.profile = normalizeProfile({
    ...state.profile,
    setupComplete: true,
    title: state.profile.title || String(form.get("targetRole") || ""),
    goals: {
      targetRole: form.get("targetRole"),
      experienceLevel: form.get("experienceLevel"),
      jobType: form.get("jobType"),
      workMode: form.get("workMode"),
      startTimeline: form.get("startTimeline"),
      locations: form.get("locations"),
      salaryRange: form.get("salaryRange"),
      prioritySkills: asList(form.get("prioritySkills")),
      preferredCompanies: form.get("preferredCompanies"),
      jobBoards: form.get("jobBoards")
    }
  });
  await saveProfileDocument("Job goals saved. Now add resume/profile details.");
  hydrateProfileForm();
  switchView("profile");
}

async function saveProfile(event) {
  event.preventDefault();
  requireLogin();
  const form = new FormData(event.currentTarget);
  state.profile = normalizeProfile({
    ...state.profile,
    name: form.get("name"),
    title: form.get("title"),
    email: form.get("email"),
    phone: form.get("phone"),
    location: form.get("location"),
    linkedin: form.get("linkedin"),
    skills: asList(form.get("skills")),
    domains: asList(form.get("domains")),
    resumeText: form.get("resumeText"),
    highlights: asList(form.get("highlights"))
  });
  state.jobs = state.jobs.map((job) => ({ ...job, score: scoreJob(job.description || "") }));
  await saveProfileDocument("Resume profile saved to Firestore.");
  renderAll();
}

async function saveProfileDocument(message) {
  persistLocal();
  await profileRef().set(state.profile, { merge: true });
  setCloudStatus("Firestore", message);
}

function renderMetrics() {
  const thisWeek = new Date();
  thisWeek.setDate(thisWeek.getDate() + 7);
  document.querySelector("#totalJobs").textContent = state.jobs.length;
  document.querySelector("#strongMatches").textContent = state.jobs.filter((job) => job.score.percent >= 90).length;
  document.querySelector("#interviewCount").textContent = state.jobs.filter((job) => job.status === "Interview").length;
  document.querySelector("#followUps").textContent = state.jobs.filter((job) => new Date(job.followUpAt) <= thisWeek).length;
}

function renderPriority() {
  const jobs = [...state.jobs].sort((a, b) => new Date(a.followUpAt) - new Date(b.followUpAt) || b.score.percent - a.score.percent).slice(0, 5);
  document.querySelector("#priorityList").innerHTML = jobs.length
    ? jobs.map((job) => `<article class="priority-item"><div><strong>${escapeHtml(job.role)}</strong><small>${escapeHtml(job.company)} - ${escapeHtml(job.status)} - follow up ${formatDate(job.followUpAt)}</small></div><span class="score-pill">${job.score.percent}%</span></article>`).join("")
    : emptyState("No jobs tracked yet.");
}

function renderPipeline() {
  const statuses = ["Wishlist", "Applied", "Interview", "Offer", "Rejected"];
  const max = Math.max(1, ...statuses.map((status) => state.jobs.filter((job) => job.status === status).length));
  document.querySelector("#pipelineBars").innerHTML = statuses.map((status) => {
    const count = state.jobs.filter((job) => job.status === status).length;
    return `<div class="bar-row"><span>${status}</span><div class="bar-track"><div class="bar-fill" style="width:${(count / max) * 100}%"></div></div><b>${count}</b></div>`;
  }).join("");
}

function renderJobs() {
  const list = document.querySelector("#jobList");
  const jobs = state.filter === "All" ? state.jobs : state.jobs.filter((job) => job.status === state.filter);
  list.innerHTML = jobs.length ? jobs.map(jobCard).join("") : emptyState("No jobs match this filter.");

  list.querySelectorAll("[data-status-id]").forEach((select) => select.addEventListener("change", (event) => updateStatus(event.target.dataset.statusId, event.target.value)));
  list.querySelectorAll("[data-kit-id]").forEach((button) => button.addEventListener("click", () => {
    state.selectedKitJobId = button.dataset.kitId;
    renderKitOptions();
    switchView("kit");
    renderKit();
  }));
  list.querySelectorAll("[data-delete-id]").forEach((button) => button.addEventListener("click", () => deleteJob(button.dataset.deleteId)));
}

function jobCard(job) {
  const matched = job.score.matched.slice(0, 7).map(chip).join("");
  return `<article class="job-card"><div class="job-card-top"><div><strong>${escapeHtml(job.role)}</strong><small>${escapeHtml(job.company)} - ${escapeHtml(job.location || "Location not set")} - added ${formatDate(job.createdAt)}</small></div><span class="score-pill">${job.score.percent}%</span></div><div class="chip-cloud">${matched}</div><div class="job-actions"><select class="status-select" data-status-id="${job.id}" aria-label="Update status for ${escapeHtml(job.role)}">${["Wishlist", "Applied", "Interview", "Offer", "Rejected"].map((status) => `<option ${job.status === status ? "selected" : ""}>${status}</option>`).join("")}</select>${job.url ? `<a href="${escapeHtml(job.url)}" target="_blank" rel="noreferrer">Open job</a>` : ""}<button data-kit-id="${job.id}">Build kit</button><button data-delete-id="${job.id}">Delete</button></div></article>`;
}

async function saveJob(event) {
  event.preventDefault();
  requireLogin();
  const form = new FormData(event.currentTarget);
  const description = String(form.get("description"));
  const job = {
    id: crypto.randomUUID(),
    company: String(form.get("company")),
    role: String(form.get("role")),
    url: String(form.get("url")),
    location: String(form.get("location")),
    status: String(form.get("status")),
    description,
    createdAt: new Date().toISOString(),
    followUpAt: daysFromNow(4),
    score: scoreJob(description)
  };
  state.jobs.unshift(job);
  state.selectedKitJobId = job.id;
  persistLocal();
  await jobRef(job.id).set(job, { merge: true });
  event.currentTarget.reset();
  renderAll();
}

async function updateStatus(id, status) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return;
  job.status = status;
  job.followUpAt = status === "Applied" ? daysFromNow(4) : status === "Interview" ? daysFromNow(1) : job.followUpAt;
  persistLocal();
  await jobRef(job.id).set(job, { merge: true });
  renderAll();
}

async function deleteJob(id) {
  state.jobs = state.jobs.filter((job) => job.id !== id);
  persistLocal();
  await jobRef(id).delete();
  renderAll();
}

function scoreLabDescription() {
  renderLabScore(scoreJob(document.querySelector("#labDescription").value));
}

function scoreJob(description) {
  const text = normalize(description);
  const goalTerms = [state.profile.goals?.targetRole, state.profile.goals?.experienceLevel, state.profile.goals?.jobType, state.profile.goals?.workMode, state.profile.goals?.locations, ...asList(state.profile.goals?.prioritySkills), state.profile.goals?.preferredCompanies].filter(Boolean);
  const resumeTerms = [...state.profile.skills, ...state.profile.domains, ...state.profile.highlights, ...asList(state.profile.resumeText)];
  const ownedTerms = [...goalTerms, ...resumeTerms].filter(Boolean);
  const commonGapTerms = ["React", "Node.js", "TypeScript", "AWS", "Docker", "Kubernetes", "GraphQL", "Java", "Spring Boot", "Python", "Laravel", "MongoDB", "PostgreSQL"];
  const matched = [];
  const missing = [];
  let earned = 0;
  let possible = 0;

  ownedTerms.forEach((term) => {
    const normalized = normalize(term);
    if (!normalized || normalized.length < 2) return;
    const weight = normalized.split(" ").length > 2 ? 4 : 3;
    if (text.includes(normalized)) {
      earned += weight;
      possible += weight;
      if (!matched.includes(term)) matched.push(term);
    }
  });

  commonGapTerms.forEach((term) => {
    if (text.includes(normalize(term)) && !ownedTerms.map(normalize).includes(normalize(term))) {
      possible += 5;
      missing.push(term);
    }
  });

  const targetBoost = state.profile.goals?.targetRole && text.includes(normalize(state.profile.goals.targetRole)) ? 8 : 0;
  const densityBoost = Math.min(8, Math.floor(matched.length / 3));
  const percent = possible ? Math.min(99, Math.round((earned / possible) * 100 + targetBoost + densityBoost)) : 0;
  return { percent, matched, missing: missing.slice(0, 12), verdict: percent >= 90 ? "Excellent fit" : percent >= 75 ? "Good fit" : percent >= 55 ? "Possible fit" : "Low fit" };
}

function renderLabScore(score) {
  const ring = document.querySelector("#labScore");
  ring.style.setProperty("--score", `${score.percent}%`);
  ring.dataset.score = `${score.percent}%`;
  document.querySelector("#labVerdict").textContent = score.verdict;
  document.querySelector("#labSummary").textContent = score.percent >= 90 ? "Strong fit. Use the matched terms in your resume headline, summary, and recruiter message." : "Review missing terms before applying or tailor your profile first.";
  document.querySelector("#labMatched").innerHTML = score.matched.slice(0, 16).map(chip).join("") || chip("No clear matches");
  document.querySelector("#labMissing").innerHTML = score.missing.map(chip).join("") || chip("No major gaps");
}

function renderKitOptions() {
  const select = document.querySelector("#kitJobSelect");
  if (!state.selectedKitJobId && state.jobs.length) state.selectedKitJobId = state.jobs[0].id;
  select.innerHTML = state.jobs.map((job) => `<option value="${job.id}" ${job.id === state.selectedKitJobId ? "selected" : ""}>${escapeHtml(job.company)} - ${escapeHtml(job.role)}</option>`).join("");
}

function renderKit() {
  const job = state.jobs.find((item) => item.id === state.selectedKitJobId) || state.jobs[0];
  const details = document.querySelector("#kitDetails");
  const output = document.querySelector("#messageOutput");
  if (!job) {
    details.innerHTML = emptyState("Add a job first.");
    output.value = "";
    return;
  }
  details.innerHTML = `<div class="priority-item"><div><strong>${escapeHtml(job.role)}</strong><small>${escapeHtml(job.company)} - ${escapeHtml(job.location || "Location not set")}</small></div><span class="score-pill">${job.score.percent}%</span></div><div><p class="section-kicker">Use these points</p><div class="chip-cloud">${job.score.matched.slice(0, 12).map(chip).join("") || chip("Add profile skills")}</div></div><div><p class="section-kicker">Tailor before applying</p><div class="chip-cloud muted">${job.score.missing.slice(0, 8).map(chip).join("") || chip("No major gaps")}</div></div>`;
  output.value = buildMessage(job);
}

function buildMessage(job) {
  const topMatches = job.score.matched.slice(0, 7).join(", ");
  const highlights = state.profile.highlights.slice(0, 4).map((item) => `- ${item}`).join("\n");
  return `Subject: Application for ${job.role}\n\nHi Hiring Team,\n\nI am ${state.profile.name || "a candidate"}, applying for ${job.role} at ${job.company}. I am targeting ${state.profile.goals?.targetRole || state.profile.title || "this type of role"}, and this opening looks relevant to my skills in ${topMatches || state.profile.skills.slice(0, 6).join(", ") || "the listed requirements"}.\n\nRelevant highlights:\n${highlights || "- Profile highlights will appear here after the user adds resume details."}\n\nI would be happy to discuss how I can contribute to your team.\n\nRegards,\n${state.profile.name || "Candidate"}\n${state.profile.phone || ""}\n${state.profile.email || state.user?.email || ""}\n${state.profile.linkedin || ""}`;
}

function copyMessage() {
  const output = document.querySelector("#messageOutput");
  output.select();
  navigator.clipboard.writeText(output.value);
}

function requireLogin() {
  if (!state.user || !state.db) {
    throw new Error("Login required");
  }
}

function renderCloudStatus() {
  const status = document.querySelector("#cloudStatus");
  const detail = document.querySelector("#cloudStatusText");
  if (status) status.textContent = state.cloud.status;
  if (detail) detail.textContent = state.cloud.detail;
}

function setCloudStatus(status, detail) {
  state.cloud.status = status;
  state.cloud.detail = detail;
  renderCloudStatus();
}

function setAuthStatus(message) {
  const status = document.querySelector("#authStatus");
  if (status) status.textContent = message;
}

function readableAuthError(error) {
  const code = error?.code || "";
  if (code.includes("operation-not-allowed")) return "Enable Google and Email/Password sign-in in Firebase Authentication first.";
  if (code.includes("popup")) return "Popup was blocked or closed. Try again and allow the Google sign-in popup.";
  if (code.includes("wrong-password") || code.includes("invalid-credential")) return "Email or password is incorrect.";
  if (code.includes("user-not-found")) return "No email account exists yet. Sign in with Google first, or ask the admin to create an email account.";
  return error?.message || "Authentication failed.";
}

function asList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "").split(/[\n,|]+/).map((item) => item.trim()).filter(Boolean);
}

function chip(label) {
  return `<span class="chip">${escapeHtml(label)}</span>`;
}

function emptyState(message) {
  return `<div class="priority-item"><div><strong>${escapeHtml(message)}</strong><small>Add a job description to begin tracking.</small></div></div>`;
}

function normalize(value) {
  return String(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9+#.]+/g, " ").trim();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(new Date(value));
}

function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}