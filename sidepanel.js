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
let cvSyncFailed = false;
let cvSyncError = "";
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
  // loadCredits MUST finish before detectJob, so CV gate has correct state
  await loadCredits();
  await Promise.allSettled([detectJob(), loadHistory()]);
}

function applyCvGate() {
  if (cvSyncFailed) {
    cvRequired?.classList.remove("hidden");
    btnScan.disabled = true;
    const detail = cvSyncError ? ` (${cvSyncError})` : "";
    setStatus("error", `Sync gagal${detail} — klik Refresh Status atau coba Logout lalu login ulang`);
    return;
  }

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
    // Try dashboard tab sync
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "SYNC_AUTH_NOW" }, () => resolve());
    });
    token = await getAuthToken();
  }

  if (!token) {
    // Production: dashboard tab may need a moment to finish loading.
    // Poll up to 5s before giving up and showing auth screen.
    for (let i = 0; i < 5 && !token; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      token = await getAuthToken();
    }
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

    if (!token && !syncResult?.success) {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "SYNC_AUTH_FROM_ACTIVE_TAB" }, () => resolve());
      });
    }

    // Wait briefly for async storage writes after SYNC_AUTH_NOW.
    for (let i = 0; i < 10 && !token; i++) {
      await new Promise((r) => setTimeout(r, 350));
      token = await getAuthToken();
    }

    if (!token && syncResult?.error) {
      console.warn("[FYJOB] Retry sync failed:", syncResult.error);
    }
  }

  if (token) {
    await bootAuthenticatedView();
    ui.notify("success", "Session tersinkron. Extension siap dipakai.", "Connected", 2800);
  } else {
    ui.notify(
      "warn",
      "Session belum terbaca. Pastikan tab dashboard sudah benar-benar login, tetap terbuka, lalu klik Retry lagi.",
      "Session Belum Tersinkron",
      7000
    );
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

$("#btn-refresh-cv-status")?.addEventListener("click", async () => {
  setStatus("detecting", "Syncing session...");
  // Re-sync auth from dashboard tab before retrying API
  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "SYNC_AUTH_NOW" }, () => resolve());
  });
  await loadCredits();
});

// ─── Credits ───
function applyStatsToUI(stats) {
  hasUploadedCV = Boolean(stats.cv_uploaded);
  const pill = $("#credit-pill");
  ui.applyCreditPill(creditCount, pill, stats);
  const emailLabel = $("#user-email-label");
  if (emailLabel && stats.email) {
    emailLabel.textContent = stats.email;
    emailLabel.title = stats.email;
  }
}

async function loadCredits() {
  cvSyncFailed = false;
  cvSyncError = "";
  const delays = [2000, 4000]; // retry delays for cold starts / transient failures
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, delays[attempt - 1]));
      }
      const stats = await getUserStats();
      applyStatsToUI(stats);
      applyCvGate();
      return;
    } catch (e) {
      if (e.message === "NOT_AUTHENTICATED") {
        showAuth();
        return;
      }
      if (attempt < delays.length) continue; // will retry
      // All retries exhausted
      creditCount.textContent = "?";
      cvSyncFailed = true;
      cvSyncError = e.message || "";
      applyCvGate();
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
      ui.notify("warn", "Kredit habis. Tunggu regen harian atau buka Dashboard untuk detail.", "Kredit Habis", 6500);
    } else if (e.message === "NOT_AUTHENTICATED") {
      showAuth();
    } else {
      ui.notify("error", `Analysis gagal: ${e.message}`, "Analysis Error", 7000);
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

// ─── Auto-refresh when sidepanel regains focus ───
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && mainScreen && !mainScreen.classList.contains("hidden")) {
    loadCredits();
  }
});

// ─── Boot ───
document.addEventListener("DOMContentLoaded", init);
