/**
 * FYJOB Extension — Side Panel Logic
 * Handles: Auth flow, Job extraction, Analysis, Chat, History
 */

const ui = window.SidepanelUI;

// ─── Dashboard URL ───
const DEFAULT_DASHBOARD_URL = "https://fyjob.my.id";
let DASHBOARD_URL = DEFAULT_DASHBOARD_URL;

function normalizeDashboardUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed)
    ? trimmed.replace(/\/$/, "")
    : `https://${trimmed.replace(/^\/+/, "").replace(/\/$/, "")}`;
}

async function hydrateDashboardUrl() {
  try {
    const data = await chrome.storage.local.get(["fyjob_dashboard_url"]);
    const fromStorage = normalizeDashboardUrl(data?.fyjob_dashboard_url);
    DASHBOARD_URL = fromStorage || DEFAULT_DASHBOARD_URL;
  } catch {
    DASHBOARD_URL = DEFAULT_DASHBOARD_URL;
  }
}

// ─── Auto-detect auth token arrival ───
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.fyjob_token?.newValue) {
    bootAuthenticatedView();
  }
  if (namespace === "local" && changes.fyjob_token && !changes.fyjob_token.newValue) {
    resetAnalysisState();
    showAuth();
  }
});

// ─── DOM Elements ───
const $ = (sel) => document.querySelector(sel);
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
const scoreRingFill = $("#score-ring-fill");
const scoreNumber = $("#score-number");
const scoreLabel = $("#score-label");
const skillGaps = $("#skill-gaps");
const insightText = $("#insight-text");
const creditCount = $("#credit-count");
const historyList = $("#history-list");
const btnDashboard = $("#btn-dashboard");
const cvRequired = $("#cv-required");
const btnOpenCvManager = $("#btn-open-cv-manager");
const btnOpenCvflow = $("#btn-open-cvflow");

// ─── State ───
let currentJobData = null;
let currentAnalysis = null;
let conversationHistory = [];
let lastDetectedUrl = "";
let hasUploadedCV = false;
let authAutoSyncTimer = null;

const jobCardElements = {
  jobCard,
  jobTitle,
  jobCompany,
  jobPortal,
  jobDescPreview,
};

const resultElements = {
  resultsSection,
  scoreRingFill,
  scoreNumber,
  scoreLabel,
  skillGaps,
  insightText,
  btnDashboard,
};

function resetAnalysisState() {
  currentJobData = null;
  currentAnalysis = null;
  conversationHistory = [];
  resultsSection?.classList.add("hidden");
}

async function bootAuthenticatedView() {
  showMain();
  await Promise.allSettled([loadCredits(), detectJob(), loadHistory()]);
}

function applyCvGate() {
  if (!hasUploadedCV) {
    cvRequired?.classList.remove("hidden");
    btnScan.disabled = true;
    setStatus("error", "Upload CV dulu di dashboard sebelum scan job");
    return;
  }

  cvRequired?.classList.add("hidden");
  if (currentJobData?.jobDescription && currentJobData.jobDescription.length >= 50) {
    btnScan.disabled = false;
  }
}

// ─── Listen for tab navigation → auto re-detect job ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TAB_UPDATED" && message.url) {
    // Only re-detect if URL actually changed (avoid duplicate scrapes)
    if (message.url !== lastDetectedUrl && mainScreen && !mainScreen.classList.contains("hidden")) {
      lastDetectedUrl = message.url;
        resetAnalysisState();
      detectJob();
    }
  }
});

// ─── Init ───
async function init() {
  await hydrateDashboardUrl();
  let token = await getAuthToken();

  if (!token) {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "SYNC_AUTH_NOW" }, () => resolve());
    });
    token = await getAuthToken();
  }

  if (token) {
    await bootAuthenticatedView();
  } else {
    showAuth();
  }
}

// ─── Auth ───
function showAuth() {
  authScreen.classList.remove("hidden");
  mainScreen.classList.add("hidden");

  if (!authAutoSyncTimer) {
    authAutoSyncTimer = setInterval(async () => {
      try {
        let token = await getAuthToken();
        if (!token) {
          await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: "SYNC_AUTH_NOW" }, () => resolve());
          });
          token = await getAuthToken();
        }
        if (token) {
          clearInterval(authAutoSyncTimer);
          authAutoSyncTimer = null;
          await bootAuthenticatedView();
        }
      } catch {
        // keep silent auto-polling
      }
    }, 3000);
  }
}

function showMain() {
  authScreen.classList.add("hidden");
  mainScreen.classList.remove("hidden");
  if (authAutoSyncTimer) {
    clearInterval(authAutoSyncTimer);
    authAutoSyncTimer = null;
  }
}

$("#btn-login").addEventListener("click", () => {
  // Open dashboard in new tab for login
  chrome.tabs.create({ url: `${DASHBOARD_URL}/auth` });
});

$("#btn-retry").addEventListener("click", async () => {
  let token = await getAuthToken();
  if (!token) {
    const syncResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "SYNC_AUTH_NOW" }, (res) => resolve(res || null));
    });

    // Wait briefly for async storage writes after SYNC_AUTH_NOW.
    for (let i = 0; i < 6 && !token; i++) {
      await new Promise((r) => setTimeout(r, 350));
      token = await getAuthToken();
    }

    if (!token && syncResult?.error) {
      console.warn("[FYJOB] Retry sync failed:", syncResult.error);
    }
  }

  if (token) {
    await bootAuthenticatedView();
  } else {
    alert("Session belum tersedia. Pastikan kamu sudah login di Dashboard FYJOB, lalu klik Retry lagi.");
  }
});

$("#btn-logout")?.addEventListener("click", async () => {
  chrome.runtime.sendMessage({ type: "LOGOUT" }, () => {
    resetAnalysisState();
    showAuth();
  });
});

btnOpenCvManager?.addEventListener("click", () => {
  chrome.tabs.create({ url: `${DASHBOARD_URL}/dashboard/cv` });
});

btnOpenCvflow?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://flowcv.com/" });
});

// ─── Credits ───
async function loadCredits() {
  try {
    const stats = await getUserStats();
    hasUploadedCV = Boolean(stats.cv_uploaded);
    const pill = $("#credit-pill");
    ui.applyCreditPill(creditCount, pill, stats);

    applyCvGate();
  } catch (e) {
    if (e.message === "NOT_AUTHENTICATED") {
      showAuth();
    } else {
      creditCount.textContent = "?";
    }
  }
}

// ─── Job Detection ───
async function detectJob() {
  if (!hasUploadedCV) {
    applyCvGate();
    return;
  }

  setStatus("detecting", "Extracting job data...");

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "EXTRACT_JOB" }, (res) => {
        resolve(res);
      });
    });

    if (response?.error) {
      if (response.error.includes("Content script not ready")) {
        setStatus("error", "Content script missing — Please REFRESH the LinkedIn page (F5)!");
      } else {
        setStatus("error", "Error: " + response.error);
      }
      ui.clearJobCard(jobCard);
      btnScan.disabled = true;
      return;
    }

    if (response?.success && response.data) {
      currentJobData = response.data;

      // Validate we have enough text
      if (!currentJobData.jobDescription || currentJobData.jobDescription.length < 50) {
        setStatus("error", "Job description too short to analyze");
        ui.clearJobCard(jobCard);
        btnScan.disabled = true;
        return;
      }

      ui.renderJobCard(jobCardElements, currentJobData);
      btnScan.disabled = false;
      lastDetectedUrl = currentJobData.url || "";
      setStatus("active", `Ready — ${currentJobData.portal}`);
      applyCvGate();
    } else {
      setStatus("error", "Could not extract job data");
      btnScan.disabled = true;
    }
  } catch (e) {
    setStatus("error", "Extraction failed: " + e.message);
    btnScan.disabled = true;
  }
}

function setStatus(type, text) {
  ui.setStatus(statusDot, statusText, type, text);
}

// ─── Scan (Analyze) ───
btnScan.addEventListener("click", async () => {
  if (!currentJobData) return;

  btnScan.disabled = true;
  scanLoading.classList.remove("hidden");
  resultsSection.classList.add("hidden");

  try {
    const result = await analyzeJob({
      jobTitle: currentJobData.jobTitle,
      company: currentJobData.company,
      jobDescription: currentJobData.jobDescription,
      portal: currentJobData.portal,
      url: currentJobData.url
    });

    currentAnalysis = result;
    conversationHistory = [];
    renderResults(result);

    // Update credits
    creditCount.textContent = result.credits_remaining ?? creditCount.textContent;

    // Refresh history
    loadHistory();

    // Auto open Web Dashboard with context
    const analysisId = result.id || result.analysis_id;
    if (analysisId) {
      chrome.tabs.create({ url: `${DASHBOARD_URL}/dashboard?context=${analysisId}` });
    }
  } catch (e) {
    if (e.message === "NO_CREDITS") {
      alert("Kredit habis! Tunggu besok untuk mendapat +1 kredit, atau buka Dashboard untuk info lebih lanjut.");
    } else if (e.message === "NOT_AUTHENTICATED") {
      showAuth();
    } else {
      alert("Analysis failed: " + e.message);
    }
  } finally {
    scanLoading.classList.add("hidden");
    btnScan.disabled = false;
  }
});

// ─── Render Results ───
function renderResults(data) {
  ui.renderResults(resultElements, data, DASHBOARD_URL, animateNumber);
}

function animateNumber(el, from, to, duration) {
  const start = performance.now();
  const tick = (now) => {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out quad
    const eased = 1 - (1 - progress) * (1 - progress);
    el.textContent = Math.round(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ─── History ───
async function loadHistory() {
  try {
    const history = await getAnalysisHistory(5);
    ui.renderHistory(historyList, history);
  } catch (e) {
    if (e.message === "NOT_AUTHENTICATED") return;
    historyList.innerHTML = ui.ERROR_HISTORY_MARKUP;
  }
}

// ─── Boot ───
document.addEventListener("DOMContentLoaded", init);
