const ui = window.SidepanelUI;

const DEFAULT_DASHBOARD_URL = "https://www.fyjob.my.id";
let DASHBOARD_URL = DEFAULT_DASHBOARD_URL;

const $ = (selector) => document.querySelector(selector);

const authScreen = $("#auth-screen");
const mainScreen = $("#main-screen");
const statusDot = $(".status-dot");
const statusText = $("#status-text");

const jobCard = $("#job-card");
const jobTitle = $("#job-title");
const jobCompany = $("#job-company");
const jobPortal = $("#job-portal");
const jobDescPreview = $("#job-desc-preview");

const btnScan = $("#btn-scan");
const scanLoading = $("#scan-loading");
const resultsSection = $("#results-section");
const scoreNumber = $("#score-number");
const scoreLabel = $("#score-label");
const skillGaps = $("#skill-gaps");
const insightText = $("#insight-text");
const btnDashboard = $("#btn-dashboard");

const creditCount = $("#credit-count");
const historyList = $("#history-list");
const cvRequired = $("#cv-required");

let currentJobData = null;
let isBooting = false;
let hasUploadedCV = false;

function setStatus(type, text) {
  ui.setStatus(statusDot, statusText, type, text);
}

function animateNumber(el, start, end, duration = 550) {
  const startAt = performance.now();
  const total = end - start;
  const step = (now) => {
    const progress = Math.min(1, (now - startAt) / duration);
    const value = Math.round(start + total * progress);
    el.textContent = String(value);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function hydrateDashboardUrl() {
  try {
    const data = await chrome.storage.local.get(["fyjob_dashboard_url"]);
    if (data?.fyjob_dashboard_url) {
      DASHBOARD_URL = String(data.fyjob_dashboard_url).replace(/\/$/, "");
    }
  } catch {
    DASHBOARD_URL = DEFAULT_DASHBOARD_URL;
  }
}

async function getAuthToken() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_AUTH_TOKEN" }, (res) => {
      resolve(res?.token || null);
    });
  });
}

function showAuth() {
  authScreen.classList.remove("hidden");
  mainScreen.classList.add("hidden");
  setStatus("error", "Belum login. Buka dashboard untuk login.");
}

function showMain() {
  authScreen.classList.add("hidden");
  mainScreen.classList.remove("hidden");
}

function applyCvGate() {
  if (!hasUploadedCV) {
    cvRequired.classList.remove("hidden");
    btnScan.disabled = true;
    setStatus("error", "Upload CV dulu di dashboard.");
    return;
  }
  cvRequired.classList.add("hidden");
  btnScan.disabled = !currentJobData;
}

async function loadCredits() {
  const stats = await getUserStats();
  hasUploadedCV = Boolean(stats?.cv_uploaded);
  ui.applyCreditPill(creditCount, $("#credit-pill"), stats);
  const emailLabel = $("#user-email-label");
  if (emailLabel) {
    emailLabel.textContent = stats?.email || "-";
    emailLabel.title = stats?.email || "";
  }
  applyCvGate();
}

async function loadHistory() {
  try {
    const list = await getAnalysisHistory(5);
    ui.renderHistory(historyList, list || []);
  } catch {
    historyList.innerHTML = ui.ERROR_HISTORY_MARKUP;
  }
}

async function detectJob() {
  setStatus("active", "Reading job page...");
  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "EXTRACT_JOB" }, (res) => resolve(res || null));
  });

  if (!response?.success || !response?.jobData) {
    currentJobData = null;
    ui.clearJobCard(jobCard);
    setStatus("error", response?.error || "Buka halaman job portal dulu.");
    applyCvGate();
    return;
  }

  currentJobData = response.jobData;
  ui.renderJobCard(
    { jobCard, jobTitle, jobCompany, jobPortal, jobDescPreview },
    currentJobData
  );
  setStatus("active", "Job detected. Ready to analyze.");
  applyCvGate();
}

async function consumePendingScan() {
  const payload = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "CONSUME_PENDING_SCAN" }, (res) => resolve(res || null));
  });

  if (payload?.success && payload?.jobData) {
    currentJobData = payload.jobData;
    ui.renderJobCard(
      { jobCard, jobTitle, jobCompany, jobPortal, jobDescPreview },
      currentJobData
    );
    setStatus("active", "Job loaded from floating button.");
    applyCvGate();
    if (hasUploadedCV) {
      await handleScan();
    }
  }
}

async function handleScan() {
  if (!currentJobData) {
    setStatus("error", "Job belum terbaca.");
    return;
  }

  const token = await getAuthToken();
  if (!token) {
    showAuth();
    return;
  }

  if (!hasUploadedCV) {
    applyCvGate();
    return;
  }

  btnScan.disabled = true;
  scanLoading.classList.remove("hidden");
  setStatus("active", "Analyzing with FYJOB...");

  try {
    const result = await analyzeJob(currentJobData);
    ui.renderResults(
      { resultsSection, scoreNumber, scoreLabel, skillGaps, insightText, btnDashboard },
      result,
      DASHBOARD_URL,
      animateNumber
    );
    setStatus("active", "Analysis complete.");
    await loadHistory();
  } catch (e) {
    setStatus("error", e?.message || "Analysis failed.");
  } finally {
    scanLoading.classList.add("hidden");
    btnScan.disabled = false;
  }
}

async function boot() {
  if (isBooting) return;
  isBooting = true;

  await hydrateDashboardUrl();

  let token = await getAuthToken();
  if (!token) {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "SYNC_AUTH_NOW" }, () => resolve());
    });
    token = await getAuthToken();
  }

  if (!token) {
    showAuth();
    isBooting = false;
    return;
  }

  showMain();

  try {
    await loadCredits();
    await Promise.allSettled([loadHistory(), detectJob(), consumePendingScan()]);
  } catch (e) {
    if (e?.message === "NOT_AUTHENTICATED") {
      showAuth();
    } else {
      setStatus("error", e?.message || "Init failed");
    }
  } finally {
    isBooting = false;
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.fyjob_token?.newValue) {
    boot();
  }
  if (changes.fyjob_token && !changes.fyjob_token.newValue) {
    showAuth();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TAB_UPDATED") {
    detectJob();
  }
});

$("#btn-login").addEventListener("click", () => {
  chrome.tabs.create({ url: `${DASHBOARD_URL}/auth` });
});

$("#btn-retry").addEventListener("click", async () => {
  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "SYNC_AUTH_NOW" }, () => resolve());
  });
  await boot();
});

$("#btn-open-cv-manager").addEventListener("click", () => {
  chrome.tabs.create({ url: `${DASHBOARD_URL}/dashboard/cv` });
});

$("#btn-refresh-cv-status").addEventListener("click", async () => {
  try {
    await loadCredits();
    setStatus("active", "Status updated.");
  } catch (e) {
    setStatus("error", e?.message || "Failed refresh status.");
  }
});

$("#btn-logout").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "LOGOUT" }, () => {
    showAuth();
  });
});

btnScan.addEventListener("click", () => {
  handleScan();
});

boot();
