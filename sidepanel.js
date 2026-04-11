/**
 * FYJOB Extension — Side Panel Logic
 * Handles: Auth flow, Job extraction, Analysis, Chat, History
 */

// ─── Dashboard URL ───
const DASHBOARD_URL = "https://fyjob.my.id";

// ─── Auto-detect auth token arrival ───
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.fyjob_token?.newValue) {
    // Token just arrived! Switch to main screen automatically
    showMain();
    loadCredits();
    detectJob();
    loadHistory();
  }
  if (namespace === "local" && changes.fyjob_token && !changes.fyjob_token.newValue) {
    // Token was removed (logout)
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
      // Clear old analysis so user doesn't see stale results
      currentAnalysis = null;
      conversationHistory = [];
      resultsSection?.classList.add("hidden");
      detectJob();
    }
  }
});

// ─── Init ───
async function init() {
  const token = await getAuthToken();

  if (token) {
    showMain();
    loadCredits();
    detectJob();
    loadHistory();
  } else {
    showAuth();
  }
}

// ─── Auth ───
function showAuth() {
  authScreen.classList.remove("hidden");
  mainScreen.classList.add("hidden");
}

function showMain() {
  authScreen.classList.add("hidden");
  mainScreen.classList.remove("hidden");
}

$("#btn-login").addEventListener("click", () => {
  // Open dashboard in new tab for login
  chrome.tabs.create({ url: `${DASHBOARD_URL}/auth` });
});

$("#btn-retry").addEventListener("click", async () => {
  let token = await getAuthToken();
  if (!token) {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "SYNC_AUTH_NOW" }, () => resolve());
    });
    token = await getAuthToken();
  }

  if (token) {
    showMain();
    loadCredits();
    detectJob();
    loadHistory();
  } else {
    alert("Session belum tersedia. Pastikan kamu sudah login di Dashboard FYJOB, lalu klik Retry lagi.");
  }
});

$("#btn-logout").addEventListener("click", async () => {
  chrome.runtime.sendMessage({ type: "LOGOUT" }, () => {
    currentJobData = null;
    currentAnalysis = null;
    conversationHistory = [];
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
    const isAdmin = stats.role === "admin";

    if (isAdmin) {
      creditCount.textContent = "∞";
      pill.style.borderColor = "rgba(139,92,246,0.4)";
      pill.style.color = "#a78bfa";
      pill.style.background = "rgba(139,92,246,0.1)";
    } else {
      creditCount.textContent = stats.credits_remaining ?? "—";
      if (stats.credits_remaining <= 0) {
        pill.style.borderColor = "rgba(248,113,113,0.3)";
        pill.style.color = "var(--danger)";
        pill.style.background = "var(--danger-dim)";
      }
    }

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
      jobCard.classList.add("hidden");
      btnScan.disabled = true;
      return;
    }

    if (response?.success && response.data) {
      currentJobData = response.data;

      // Validate we have enough text
      if (!currentJobData.jobDescription || currentJobData.jobDescription.length < 50) {
        setStatus("error", "Job description too short to analyze");
        jobCard.classList.add("hidden");
        btnScan.disabled = true;
        return;
      }

      // Populate job card
      jobTitle.textContent = currentJobData.jobTitle || "Unknown Position";
      jobCompany.textContent = currentJobData.company || "Unknown Company";
      jobPortal.textContent = currentJobData.portal;
      jobDescPreview.textContent = currentJobData.jobDescription.substring(0, 200) + "...";

      jobCard.classList.remove("hidden");
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
  statusText.textContent = text;
  statusDot.className = "status-dot";
  if (type === "active") statusDot.classList.add("active");
  if (type === "error") statusDot.classList.add("error");
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
  resultsSection.classList.remove("hidden");

  // Score animation
  const score = data.matchScore || 0;
  const circumference = 314; // 2 * π * 50
  const offset = circumference - (score / 100) * circumference;

  // Animate score ring
  setTimeout(() => {
    scoreRingFill.style.strokeDashoffset = offset;

    // Color based on score
    if (score >= 80) {
      scoreRingFill.style.stroke = "var(--success)";
      scoreLabel.textContent = "STRONG MATCH";
      scoreLabel.style.color = "var(--success)";
    } else if (score >= 60) {
      scoreRingFill.style.stroke = "var(--primary)";
      scoreLabel.textContent = "COMPETITIVE";
      scoreLabel.style.color = "var(--primary)";
    } else if (score >= 40) {
      scoreRingFill.style.stroke = "var(--warning)";
      scoreLabel.textContent = "NEEDS WORK";
      scoreLabel.style.color = "var(--warning)";
    } else {
      scoreRingFill.style.stroke = "var(--danger)";
      scoreLabel.textContent = "HIGH RISK";
      scoreLabel.style.color = "var(--danger)";
    }
  }, 100);

  // Animate number count-up
  animateNumber(scoreNumber, 0, score, 1200);

  // Skill gaps
  skillGaps.innerHTML = "";
  const gaps = data.gaps || [];
  gaps.forEach((gap, i) => {
    const tag = document.createElement("span");
    tag.className = `tag ${i < 3 ? "tag-danger" : "tag-warning"}`;
    tag.textContent = gap;
    skillGaps.appendChild(tag);
  });

  if (gaps.length === 0) {
    skillGaps.innerHTML = '<span class="tag tag-warning">No critical gaps found — impressive.</span>';
  }

  // Insights
  const insights = data.insights || [];
  insightText.textContent = insights.join("\n\n") || "Ujang is analyzing your profile...";

  // Dashboard link
  btnDashboard.href = `${DASHBOARD_URL}/dashboard`;

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
    historyList.innerHTML = "";

    if (!history || history.length === 0) {
      historyList.innerHTML = '<div style="text-align:center;color:var(--text-dim);font-size:11px;padding:12px;">No scans yet. Open a job page and hit Quick Match!</div>';
      return;
    }

    history.forEach((item) => {
      const score = item.matchScore || 0;
      const scoreClass = score >= 75 ? "high" : score >= 50 ? "mid" : "low";

      const el = document.createElement("div");
      el.className = "history-item";
      el.innerHTML = `
        <div class="history-item-left">
          <div class="history-item-title">${item.jobTitle || "Unknown"}</div>
          <div class="history-item-meta">${item.portal || ""} • ${new Date(item.created_at).toLocaleDateString()}</div>
        </div>
        <div class="history-score ${scoreClass}">${score}%</div>
      `;
      historyList.appendChild(el);
    });
  } catch (e) {
    if (e.message === "NOT_AUTHENTICATED") return;
    historyList.innerHTML = '<div style="text-align:center;color:var(--text-dim);font-size:11px;padding:12px;">Failed to load history</div>';
  }
}

// ─── Boot ───
document.addEventListener("DOMContentLoaded", init);
