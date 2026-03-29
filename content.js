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

// ─── Auth Token Sync (runs on dashboard page) ───
if (window.location.hostname === "localhost" || window.location.hostname.includes("fyjob")) {
  let lastSyncedToken = "";
  
  /**
   * Reads the Supabase session from localStorage and syncs it to the extension.
   * Returns true if a new token was synced.
   */
  const trySync = () => {
    try {
      const keys = Object.keys(localStorage);
      const supabaseKey = keys.find(k => k.startsWith("sb-") && k.endsWith("-auth-token"));
      if (!supabaseKey) return;

      const raw = localStorage.getItem(supabaseKey);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      
      // Supabase v2 stores session differently — handle both formats
      const token = parsed?.access_token 
        || parsed?.currentSession?.access_token
        || parsed?.session?.access_token;
      const email = parsed?.user?.email 
        || parsed?.currentSession?.user?.email
        || parsed?.session?.user?.email 
        || "";

      if (!token || token === lastSyncedToken) return;

      chrome.runtime.sendMessage({
        type: "SAVE_AUTH_TOKEN",
        token,
        email
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
        }
      });
    } catch (e) {
      // Silently fail — user hasn't logged in yet
    }
  };

  // ── Smart sync strategy ──

  // 1. Listen for localStorage changes (fires when Supabase updates the session)
  //    This is faster and more reliable than polling alone
  window.addEventListener("storage", (e) => {
    if (e.key && e.key.startsWith("sb-") && e.key.endsWith("-auth-token")) {
      console.log("[FYJOB] Storage event detected — syncing token");
      trySync();
    }
  });

  // 2. Listen for Supabase's custom auth events via BroadcastChannel (Supabase v2)
  try {
    const bc = new BroadcastChannel("supabase.auth");
    bc.onmessage = () => {
      console.log("[FYJOB] Supabase auth broadcast received — syncing token");
      setTimeout(trySync, 200); // Small delay to let Supabase finish writing
    };
  } catch (e) {
    // BroadcastChannel not supported — fall back to polling only
  }

  // 3. On initial page load: wait for Supabase to process OAuth hash before first sync
  //    The hash fragment takes a moment to be consumed and stored
  const hasOAuthHash = window.location.hash.includes("access_token");
  const initialDelay = hasOAuthHash ? 2000 : 500;

  setTimeout(trySync, initialDelay);

  // 4. Keep polling every 8s to catch token refreshes (less aggressive than before)
  setInterval(trySync, 8000);
}

console.log("[FYJOB] Content script loaded on:", window.location.hostname);
