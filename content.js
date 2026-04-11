/**
 * FYJOB Extension — Content Script
 * Runs on job portal pages to extract job descriptions and relay auth tokens.
 */

// ─── Job Scraper Logic ───
function extractJobData() {
  const url = window.location.href;
  let jobTitle = "";
  let company = "";
  let jobDescription = "";
  let portal = "Unknown";

  // ── Prevent Scrape on Dashboard ──
  if (url.includes("localhost") || url.includes("fyjob")) {
    throw new Error("Cannot scan FYJOB Dashboard. Open a real job portal first!");
  }

  // ── LinkedIn ──
  if (url.includes("linkedin.com")) {
    portal = "LinkedIn";
    jobTitle = document.querySelector("h1.t-24, h1.jobs-unified-top-card__job-title, .job-details-jobs-unified-top-card__job-title")?.textContent?.trim() || "";
    company = document.querySelector(".jobs-unified-top-card__company-name a, .job-details-jobs-unified-top-card__company-name")?.textContent?.trim() || "";
    
    const descEl = document.querySelector(
      ".jobs-description__content, " +
      ".jobs-box__html-content, " +
      "#job-details, " +
      ".jobs-description-content__text"
    );
    jobDescription = descEl?.innerText?.trim() || "";
  }

  // ── Indeed ──
  else if (url.includes("indeed.com")) {
    portal = "Indeed";
    jobTitle = document.querySelector("h1.jobsearch-JobInfoHeader-title, .icl-u-xs-mb--xs h1")?.textContent?.trim() || "";
    company = document.querySelector("[data-testid='inlineHeader-companyName'], .icl-u-lg-mr--sm")?.textContent?.trim() || "";
    jobDescription = document.querySelector("#jobDescriptionText, .jobsearch-jobDescriptionText")?.innerText?.trim() || "";
  }

  // ── Jobstreet ──
  else if (url.includes("jobstreet")) {
    portal = "Jobstreet";
    jobTitle = document.querySelector("h1[data-automation='job-detail-title'], h1")?.textContent?.trim() || "";
    company = document.querySelector("[data-automation='advertiser-name'], .company")?.textContent?.trim() || "";
    jobDescription = document.querySelector("[data-automation='jobAdDetails'], .job-description")?.innerText?.trim() || "";
  }

  // ── Kalibrr ──
  else if (url.includes("kalibrr.com")) {
    portal = "Kalibrr";
    jobTitle = document.querySelector("h1.css-14kcftp, h1")?.textContent?.trim() || "";
    company = document.querySelector(".css-1mg76ol a, .company-name")?.textContent?.trim() || "";
    jobDescription = document.querySelector(".css-1uaxr1c, .job-description, .k-prose")?.innerText?.trim() || "";
  }

  // ── Glints ──
  else if (url.includes("glints.com")) {
    portal = "Glints";
    jobTitle = document.querySelector("h1")?.textContent?.trim() || "";
    company = document.querySelector("a[href*='/companies/']")?.textContent?.trim() || "";
    const descContainers = document.querySelectorAll("[class*='Description'], [class*='description'], article");
    jobDescription = Array.from(descContainers).map(el => el.innerText?.trim()).join("\n\n") || "";
  }

  // ── Generic Fallback ──
  if (!jobDescription) {
    portal = portal === "Unknown" ? new URL(url).hostname.replace("www.", "") : portal;
    jobTitle = jobTitle || document.querySelector("h1")?.textContent?.trim() || document.title;
    
    // Try common selectors
    const commonSelectors = [
      "article", ".job-description", "#job-description",
      "[class*='description']", "[class*='job-detail']",
      ".posting-page", ".content-area", "main"
    ];
    
    for (const sel of commonSelectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.length > 200) {
        jobDescription = el.innerText.trim();
        break;
      }
    }
    
    // Ultimate fallback: grab body text
    if (!jobDescription || jobDescription.length < 100) {
      jobDescription = document.body.innerText.substring(0, 5000);
    }
  }

  return {
    jobTitle: jobTitle.substring(0, 200),
    company: company.substring(0, 100),
    jobDescription: jobDescription.substring(0, 8000),
    portal,
    url
  };
}

// ─── Message Handler ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SCRAPE_JOB") {
    try {
      const data = extractJobData();
      sendResponse({ success: true, data });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  }
  return true;
});

// ─── Auth Token Sync (runs only on FYJOB dashboard page) ───
const isFyjobDashboardHost = (() => {
  const host = window.location.hostname;
  const port = window.location.port;
  const isLocalDashboard = (host === "localhost" || host === "127.0.0.1") && (port === "3000" || port === "5173");
  const isFyjobDomain = host.includes("fyjob");
  return isLocalDashboard || isFyjobDomain;
})();

if (isFyjobDashboardHost) {
  let lastSyncedToken = "";
  let lastSyncedRefreshToken = "";
  const EXT_AUTH_BRIDGE_KEY = "fyjob_auth_bridge_v1";
  
  /**
   * Reads the Supabase session from localStorage and syncs it to the extension.
   * Also detects LOGOUT (token removed) and notifies the extension.
   */
  const trySync = () => {
    try {
      const bridgeRaw = localStorage.getItem(EXT_AUTH_BRIDGE_KEY);
      if (bridgeRaw) {
        try {
          const bridge = JSON.parse(bridgeRaw);
          const bridgeToken = bridge?.access_token || "";
          const bridgeRefresh = bridge?.refresh_token || "";
          const bridgeExpiresAt = bridge?.expires_at || null;
          const bridgeEmail = bridge?.email || "";

          if (bridgeToken && (bridgeToken !== lastSyncedToken || bridgeRefresh !== lastSyncedRefreshToken)) {
            chrome.runtime.sendMessage({
              type: "SAVE_AUTH_TOKEN",
              token: bridgeToken,
              email: bridgeEmail,
              refreshToken: bridgeRefresh,
              expiresAt: bridgeExpiresAt,
            }, (response) => {
              if (chrome.runtime.lastError) return;
              if (response?.success) {
                lastSyncedToken = bridgeToken;
                lastSyncedRefreshToken = bridgeRefresh;
              }
            });
            return;
          }

          if (!bridgeToken && lastSyncedToken) {
            chrome.runtime.sendMessage({ type: "SYNC_LOGOUT" });
            lastSyncedToken = "";
            lastSyncedRefreshToken = "";
            return;
          }
        } catch {
          // ignore bridge parse failures and continue to Supabase key fallback
        }
      }

      const keys = Object.keys(localStorage);
      const supabaseKey = keys.find(k => k.startsWith("sb-") && k.endsWith("-auth-token"));
      
      // Do not auto-logout extension on temporary missing key.
      // Session key can be transiently unavailable during OAuth/callback hydration.
      if (!supabaseKey || !localStorage.getItem(supabaseKey)) {
        if (lastSyncedToken) {
          // Token existed, now it's gone -> Web has logged out!
          console.log("[FYJOB] Web logout detected — notifying extension");
          chrome.runtime.sendMessage({ type: "SYNC_LOGOUT" });
          lastSyncedToken = "";
          lastSyncedRefreshToken = "";
        }
        return;
      }

      const raw = localStorage.getItem(supabaseKey);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      
      // Supabase v2 stores session differently — handle both formats
      const token = parsed?.access_token 
        || parsed?.currentSession?.access_token
        || parsed?.session?.access_token;
      const refreshToken = parsed?.refresh_token
        || parsed?.currentSession?.refresh_token
        || parsed?.session?.refresh_token
        || "";
      const expiresAt = parsed?.expires_at
        || parsed?.currentSession?.expires_at
        || parsed?.session?.expires_at
        || null;
      const email = parsed?.user?.email 
        || parsed?.currentSession?.user?.email
        || parsed?.session?.user?.email 
        || "";

      if (!token) return;
      if (token === lastSyncedToken && refreshToken === lastSyncedRefreshToken) return;

      chrome.runtime.sendMessage({
        type: "SAVE_AUTH_TOKEN",
        token,
        email,
        refreshToken,
        expiresAt
      }, (response) => {
        if (chrome.runtime.lastError) {
          // Extension context invalidated — ignore silently
          return;
        }
        if (response?.success) {
          console.log("[FYJOB] ✅ New auth token synced to extension for:", email);
          
          // Show visual indicator ONLY on first successful connection
          if (!lastSyncedToken) {
            const badge = document.createElement("div");
            badge.id = "fyjob-ext-badge";
            badge.innerHTML = `
              <div style="position:fixed;bottom:20px;left:20px;z-index:99999;background:linear-gradient(135deg,#818cf8,#6366f1);color:#fff;padding:10px 16px;border-radius:12px;font-family:Inter,sans-serif;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;box-shadow:0 4px 20px rgba(129,140,248,0.4);animation:fyjob-slide-in 0.4s ease">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Extension Connected — ${email}
              </div>
              <style>@keyframes fyjob-slide-in{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}</style>
            `;
            document.body.appendChild(badge);
            setTimeout(() => badge.remove(), 5000);
          }
          
          lastSyncedToken = token;
          lastSyncedRefreshToken = refreshToken;
        }
      });
    } catch (e) {
      // Silently fail — user hasn't logged in yet
    }
  };

  // ── Listen for LOGOUT command from extension ──
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "FORCE_WEB_LOGOUT") {
      console.log("[FYJOB] 🔒 Extension requested web logout");
      // Clear ALL Supabase auth tokens from localStorage
      const keys = Object.keys(localStorage);
      keys.forEach(k => {
        if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
          localStorage.removeItem(k);
        }
      });
      localStorage.removeItem(EXT_AUTH_BRIDGE_KEY);
      lastSyncedToken = "";
      lastSyncedRefreshToken = "";
      // Reload the page to trigger Supabase's auth state change
      window.location.reload();
      sendResponse({ success: true });
    }
    return true;
  });

  // ── Smart sync strategy ──

  // 1. Listen for localStorage changes (fires when Supabase updates the session)
  window.addEventListener("storage", (e) => {
    if (
      (e.key && e.key.startsWith("sb-") && e.key.endsWith("-auth-token"))
      || e.key === EXT_AUTH_BRIDGE_KEY
    ) {
      console.log("[FYJOB] Storage event detected — syncing token");
      trySync();
    }
  });

  // 2. Listen for Supabase's custom auth events via BroadcastChannel (Supabase v2)
  try {
    const bc = new BroadcastChannel("supabase.auth");
    bc.onmessage = (event) => {
      const authEvent = event?.data?.event;
      if (authEvent === "SIGNED_OUT" && lastSyncedToken) {
        chrome.runtime.sendMessage({ type: "SYNC_LOGOUT" });
        lastSyncedToken = "";
        lastSyncedRefreshToken = "";
        return;
      }
      console.log("[FYJOB] Supabase auth broadcast received — syncing token");
      setTimeout(trySync, 200);
    };
  } catch (e) {
    // BroadcastChannel not supported — fall back to polling only
  }

  // 3. On initial page load
  const hasOAuthHash = window.location.hash.includes("access_token");
  const initialDelay = hasOAuthHash ? 2000 : 500;
  setTimeout(trySync, initialDelay);

  // 4. Keep polling every 8s to catch token refreshes AND logouts
  setInterval(trySync, 8000);
}

console.log("[FYJOB] Content script loaded on:", window.location.hostname);
