const EXT_AUTH_BRIDGE_KEY = "fyjob_auth_bridge_v1";
const EXT_AUTH_SYNC_EVENT = "fyjob:auth-bridge-sync";

const JOB_PORTAL_MATCHERS = [
  "linkedin.com",
  "indeed.com",
  "jobs.dicoding.com",
  "dicoding.com/jobs",
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
  else if (url.includes("jobs.dicoding.com") || url.includes("dicoding.com/jobs")) portal = "Dicoding Jobs";
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

  // Immediate bridge sync from web app auth context (faster than polling).
  window.addEventListener(EXT_AUTH_SYNC_EVENT, () => {
    sync();
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


