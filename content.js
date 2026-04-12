const EXT_AUTH_BRIDGE_KEY = "fyjob_auth_bridge_v1";

const JOB_PORTAL_MATCHERS = [
  "linkedin.com",
  "indeed.com",
  "jobstreet.co.id",
  "jobstreet.com",
  "jobsdb.com",
  "kalibrr.com",
  "glints.com",
  "karir.com",
  "glassdoor.com",
  "monster.com",
  "ziprecruiter.com",
  "simplyhired.com",
  "dice.com",
  "wellfound.com",
  "builtin.com",
  "jobs.lever.co",
  "lever.co",
  "greenhouse.io",
  "boards.greenhouse.io",
  "ashbyhq.com",
  "smartrecruiters.com",
  "workable.com",
  "myworkdayjobs.com",
  "workday.com",
  "jobvite.com",
  "icims.com",
  "taleo.net",
  "recruitee.com",
  "join.com",
];

function isJobPortalUrl(url) {
  if (!url) return false;
  if (JOB_PORTAL_MATCHERS.some((item) => url.includes(item))) return true;

  // Generic fallback for unknown portals
  return /\b(job|jobs|career|careers|vacancy|vacancies|hiring|recruit|position|opening)\b/i.test(url);
}

function isLikelyJobPage() {
  if (!isJobPortalUrl(window.location.href)) return false;

  // Structured data signal for job posting pages
  const hasJobSchema = Boolean(document.querySelector('script[type="application/ld+json"]'))
    && document.documentElement.innerHTML.includes("JobPosting");
  if (hasJobSchema) return true;

  // Common text signal
  const haystack = `${document.title} ${(document.body?.innerText || "").slice(0, 2000)}`.toLowerCase();
  const hits = ["job description", "requirements", "responsibilities", "qualifications", "apply now", "career"]
    .filter((token) => haystack.includes(token)).length;
  return hits >= 2;
}

function isDashboardHost() {
  const host = window.location.hostname;
  const port = window.location.port;
  const localDashboard = (host === "localhost" || host === "127.0.0.1") && (port === "3000" || port === "5173");
  return localDashboard || host.includes("fyjob") || host.includes("vercel.app") || host.includes("azurewebsites.net");
}

function extractJobFromDom() {
  const text = (el) => (el?.textContent || "").trim();
  const bodyText = (el) => (el?.innerText || "").trim();
  const url = window.location.href;

  let portal = "Unknown";
  if (url.includes("linkedin.com")) portal = "LinkedIn";
  else if (url.includes("indeed.com")) portal = "Indeed";
  else if (url.includes("jobstreet")) portal = "Jobstreet";

  const jobTitle = text(
    document.querySelector("h1") ||
    document.querySelector("[data-automation='job-detail-title']") ||
    document.querySelector(".jobs-unified-top-card__job-title")
  );

  const company = text(
    document.querySelector("[data-automation='advertiser-name']") ||
    document.querySelector(".jobs-unified-top-card__company-name") ||
    document.querySelector("[data-testid='inlineHeader-companyName']")
  );

  const jobDescription = bodyText(
    document.querySelector("#jobDescriptionText") ||
    document.querySelector("[data-automation='jobAdDetails']") ||
    document.querySelector(".jobs-description__content") ||
    document.querySelector("main")
  );

  return {
    success: Boolean(jobDescription && jobDescription.length >= 80),
    error: "Deskripsi job belum kebaca. Scroll dulu lalu klik lagi.",
    jobData: {
      jobTitle: jobTitle || "Unknown Position",
      company: company || "Unknown Company",
      portal,
      url,
      jobDescription: jobDescription || "",
    },
  };
}

function showFabToast(message, type = "warn") {
  const existing = document.getElementById("fyjob-fab-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "fyjob-fab-toast";
  toast.textContent = message;
  toast.dataset.type = type;
  document.documentElement.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2600);
}

function mountFloatingButton() {
  if (!isLikelyJobPage()) return;
  if (document.getElementById("fyjob-fab")) return;

  const button = document.createElement("button");
  button.id = "fyjob-fab";
  button.type = "button";
  button.setAttribute("aria-label", "FYJOB Quick Analyze");
  button.innerHTML = '<img src="' + chrome.runtime.getURL("icons/icon48.png") + '" alt="FYJOB" />';

  const style = document.createElement("style");
  style.textContent = `
    #fyjob-fab {
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: 58px;
      height: 58px;
      border: none;
      border-radius: 999px;
      background: #1f63ff;
      box-shadow: 0 12px 24px rgba(31, 99, 255, 0.35);
      display: grid;
      place-items: center;
      cursor: pointer;
      z-index: 2147483647;
      transition: transform 0.14s ease, box-shadow 0.14s ease;
    }
    #fyjob-fab:hover {
      transform: translateY(-1px);
      box-shadow: 0 14px 28px rgba(31, 99, 255, 0.42);
    }
    #fyjob-fab:active {
      transform: translateY(0);
    }
    #fyjob-fab img {
      width: 28px;
      height: 28px;
      object-fit: contain;
      pointer-events: none;
      transition: transform 0.18s ease;
    }
    #fyjob-fab[data-loading="1"] {
      opacity: 0.92;
      cursor: wait;
      box-shadow: 0 10px 20px rgba(31, 99, 255, 0.22);
    }
    #fyjob-fab[data-loading="1"] img {
      animation: fyjob-fab-spin 0.9s linear infinite;
    }
    @keyframes fyjob-fab-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    #fyjob-fab-toast {
      position: fixed;
      right: 16px;
      bottom: 86px;
      z-index: 2147483647;
      max-width: 280px;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 12px;
      line-height: 1.35;
      color: #0f172a;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12);
    }
    #fyjob-fab-toast[data-type="error"] {
      border-color: #fecaca;
      color: #b91c1c;
    }
    @media (max-width: 640px) {
      #fyjob-fab {
        width: 52px;
        height: 52px;
        right: 12px;
        bottom: 12px;
      }
      #fyjob-fab img {
        width: 24px;
        height: 24px;
      }
      #fyjob-fab-toast {
        right: 12px;
        bottom: 74px;
        max-width: calc(100vw - 24px);
      }
    }
  `;

  document.documentElement.appendChild(style);
  document.documentElement.appendChild(button);

  button.addEventListener("click", () => {
    if (button.dataset.loading === "1") return;
    button.dataset.loading = "1";

    // Failsafe to avoid stuck loading state if callback never returns
    const resetTimer = setTimeout(() => {
      button.dataset.loading = "0";
    }, 8000);

    const result = extractJobFromDom();
    if (!result.success) {
      clearTimeout(resetTimer);
      button.dataset.loading = "0";
      showFabToast(result.error || "Gagal baca detail job. Coba scroll halaman lalu klik lagi.", "error");
      return;
    }

    chrome.runtime.sendMessage({
      type: "OPEN_PANEL_AND_SCAN",
      jobData: result.jobData,
      source: "fab",
      sourceUrl: window.location.href,
    }, (response) => {
      clearTimeout(resetTimer);
      button.dataset.loading = "0";

      if (chrome.runtime.lastError || !response?.success) {
        showFabToast("Gagal membuka panel FYJOB. Coba klik lagi.", "error");
      }
    });
  });
}

function initDashboardSync() {
  let lastToken = "";
  let lastRefresh = "";

  const sync = () => {
    try {
      const bridgeRaw = localStorage.getItem(EXT_AUTH_BRIDGE_KEY);
      if (bridgeRaw) {
        const parsed = JSON.parse(bridgeRaw);
        const token = parsed?.access_token || "";
        const refreshToken = parsed?.refresh_token || "";
        const expiresAt = parsed?.expires_at || null;
        const email = parsed?.email || "";

        if (token && (token !== lastToken || refreshToken !== lastRefresh)) {
          chrome.runtime.sendMessage({
            type: "SAVE_AUTH_TOKEN",
            token,
            refreshToken,
            expiresAt,
            email,
          });
          lastToken = token;
          lastRefresh = refreshToken;
          return;
        }

        if (!token && lastToken) {
          chrome.runtime.sendMessage({ type: "SYNC_LOGOUT" });
          lastToken = "";
          lastRefresh = "";
          return;
        }
      }

      const keys = Object.keys(localStorage);
      const supabaseKey = keys.find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
      if (!supabaseKey) return;

      const raw = localStorage.getItem(supabaseKey);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      const token = parsed?.access_token || parsed?.currentSession?.access_token || parsed?.session?.access_token || "";
      const refreshToken = parsed?.refresh_token || parsed?.currentSession?.refresh_token || parsed?.session?.refresh_token || "";
      const expiresAt = parsed?.expires_at || parsed?.currentSession?.expires_at || parsed?.session?.expires_at || null;
      const email = parsed?.user?.email || parsed?.currentSession?.user?.email || parsed?.session?.user?.email || "";

      if (!token) return;
      if (token === lastToken && refreshToken === lastRefresh) return;

      chrome.runtime.sendMessage({
        type: "SAVE_AUTH_TOKEN",
        token,
        refreshToken,
        expiresAt,
        email,
      });
      lastToken = token;
      lastRefresh = refreshToken;
    } catch {
      // ignore parse errors
    }
  };

  window.addEventListener("storage", (event) => {
    if (
      event.key === EXT_AUTH_BRIDGE_KEY ||
      (event.key && event.key.startsWith("sb-") && event.key.endsWith("-auth-token"))
    ) {
      sync();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "FORCE_LOGOUT_WEB") {
      try {
        localStorage.removeItem(EXT_AUTH_BRIDGE_KEY);
        const keys = Object.keys(localStorage);
        for (const key of keys) {
          if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
            localStorage.removeItem(key);
          }
        }
      } catch {
        // ignore
      }
      window.location.reload();
      sendResponse({ success: true });
      return true;
    }
    return false;
  });

  setTimeout(sync, 400);
  setInterval(sync, 5000);
}

if (isDashboardHost()) {
  initDashboardSync();
}

if (isLikelyJobPage()) {
  mountFloatingButton();
}
