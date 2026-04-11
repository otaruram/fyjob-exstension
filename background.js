/**
 * FYJOB Extension — Background Service Worker
 * Handles: Side panel lifecycle, auth token relay, content script communication
 */

const SUPABASE_URL = "https://iplciyfnwwiyjtvrvqza.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_C5rgYqsle-9YyDW1YeG67A_O_x46k5y";
const EXT_AUTH_BRIDGE_KEY = "fyjob_auth_bridge_v1";
const JOB_PORTAL_DOMAINS = [
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
  "ashbyhq.com",
  "smartrecruiters.com",
  "workable.com",
  "myworkdayjobs.com",
  "workday.com",
  "jobvite.com",
  "icims.com",
  "taleo.net",
  "boards.greenhouse.io",
  "recruitee.com",
  "join.com"
];

const isJobPortalUrl = (url) => Boolean(url) && JOB_PORTAL_DOMAINS.some((domain) => url.includes(domain));

function decodeJwtPayload(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function getJwtExpiration(token) {
  const payload = decodeJwtPayload(token);
  const exp = Number(payload?.exp);
  return Number.isFinite(exp) ? exp : null;
}

function getEffectiveExpiry(token, expiresAt) {
  const expiresAtNumber = Number(expiresAt);
  if (Number.isFinite(expiresAtNumber)) return expiresAtNumber;
  return getJwtExpiration(token);
}

function isTokenExpiringSoon(token, expiresAt, bufferSeconds = 300) {
  const effectiveExpiry = getEffectiveExpiry(token, expiresAt);
  if (!effectiveExpiry) return false;
  const nowInSeconds = Math.floor(Date.now() / 1000);
  return effectiveExpiry <= nowInSeconds + bufferSeconds;
}

async function refreshAuthTokenFromStorage() {
  const data = await chrome.storage.local.get(["fyjob_refresh_token"]);
  const refreshToken = data?.fyjob_refresh_token;
  if (!refreshToken) {
    return { success: false, error: "NO_REFRESH_TOKEN" };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      return { success: false, error: `REFRESH_FAILED_${res.status}` };
    }

    const payload = await res.json();
    const nextToken = payload?.access_token;
    const nextRefreshToken = payload?.refresh_token || refreshToken;
  const nextExpiresAt = payload?.expires_at || getJwtExpiration(nextToken);
    const email = payload?.user?.email || "";

    if (!nextToken) {
      return { success: false, error: "INVALID_REFRESH_RESPONSE" };
    }

    await chrome.storage.local.set({
      fyjob_token: nextToken,
      fyjob_refresh_token: nextRefreshToken,
      fyjob_expires_at: nextExpiresAt,
      fyjob_user_email: email,
    });

    return {
      success: true,
      token: nextToken,
      refreshToken: nextRefreshToken,
      expiresAt: nextExpiresAt,
      email,
    };
  } catch (e) {
    return { success: false, error: e.message || "REFRESH_ERROR" };
  }
}

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      await chrome.sidePanel.open({ tabId: tab.id }); // Chrome
    } else if (typeof browser !== 'undefined' && browser.sidebarAction) {
      browser.sidebarAction.open(); // Firefox
    }
  } catch (e) {
    console.error("Failed to open side panel:", e);
  }
});

// Enable side panel on supported job portal tabs + notify sidepanel of navigation
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.url) return;
  const isJobSite = isJobPortalUrl(tab.url);
  
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: true
    });
  } catch (e) {
    // Side panel API may not be available in all contexts
  }

  // Notify sidepanel when a job portal page finishes loading (URL changed / SPA nav)
  if (changeInfo.status === "complete" && isJobSite) {
    chrome.runtime.sendMessage({ type: "TAB_UPDATED", url: tab.url }).catch(() => {});
  }
});

// Also notify sidepanel when user switches between tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab?.url) {
      chrome.runtime.sendMessage({ type: "TAB_UPDATED", url: tab.url }).catch(() => {});
    }
  } catch (e) {
    // Tab might not exist anymore
  }
});

// Listen for messages from content scripts and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SAVE_AUTH_TOKEN") {
    const expiresAt = message.expiresAt || getJwtExpiration(message.token);
    chrome.storage.local.set({ 
      fyjob_token: message.token,
      fyjob_user_email: message.email || "",
      fyjob_refresh_token: message.refreshToken || "",
      fyjob_expires_at: expiresAt || null
    }, () => {
      sendResponse({ success: true });
    });
    return true; // Keep channel open for async response
  }

  if (message.type === "GET_AUTH_TOKEN") {
    (async () => {
      const data = await chrome.storage.local.get(["fyjob_token", "fyjob_user_email", "fyjob_refresh_token", "fyjob_expires_at"]);
      const hasRefreshToken = Boolean(data.fyjob_refresh_token);
      const needsRefresh = !data.fyjob_token
        ? hasRefreshToken
        : isTokenExpiringSoon(data.fyjob_token, data.fyjob_expires_at);

      if (needsRefresh) {
        const refreshed = await refreshAuthTokenFromStorage();
        if (refreshed.success) {
          sendResponse({
            token: refreshed.token,
            email: refreshed.email || "",
            refreshToken: refreshed.refreshToken || "",
            expiresAt: refreshed.expiresAt || null,
          });
          return;
        }

        sendResponse({
          token: null,
          email: data.fyjob_user_email || "",
          refreshToken: data.fyjob_refresh_token || "",
          expiresAt: null,
          error: refreshed.error || "REFRESH_FAILED",
        });
        return;
      }

      sendResponse({
        token: data.fyjob_token || null,
        email: data.fyjob_user_email || "",
        refreshToken: data.fyjob_refresh_token || "",
        expiresAt: data.fyjob_expires_at || null,
      });
    })();
    return true;
  }

  if (message.type === "SYNC_AUTH_NOW") {
    (async () => {
      try {
        const dashboardTab = await findDashboardTab();
        if (!dashboardTab?.id) {
          sendResponse({ success: false, error: "DASHBOARD_TAB_NOT_FOUND" });
          return;
        }

        const results = await chrome.scripting.executeScript({
          target: { tabId: dashboardTab.id },
          func: () => {
            const EXT_AUTH_BRIDGE_KEY = "fyjob_auth_bridge_v1";
            const getBridgeSession = () => {
              try {
                const bridgeRaw = localStorage.getItem(EXT_AUTH_BRIDGE_KEY);
                if (!bridgeRaw) return null;
                const bridge = JSON.parse(bridgeRaw);
                const token = bridge?.access_token || "";
                if (!token) return null;
                return {
                  token,
                  refreshToken: bridge?.refresh_token || "",
                  expiresAt: bridge?.expires_at ?? null,
                  email: bridge?.email || "",
                };
              } catch {
                return null;
              }
            };

            const fromHash = (() => {
              try {
                const hash = window.location.hash || "";
                const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
                const token = params.get("access_token") || "";
                const refreshToken = params.get("refresh_token") || "";
                const expiresAtRaw = params.get("expires_at");
                const expiresAt = expiresAtRaw ? Number(expiresAtRaw) : null;
                if (!token) return null;
                return { token, refreshToken, expiresAt };
              } catch {
                return null;
              }
            })();

            if (fromHash?.token) {
              return {
                token: fromHash.token,
                refreshToken: fromHash.refreshToken || "",
                expiresAt: fromHash.expiresAt ?? null,
                email: "",
              };
            }

            const fromBridge = getBridgeSession();
            if (fromBridge?.token) {
              return fromBridge;
            }

            try {
              const keys = Object.keys(localStorage);
              const supabaseKey = keys.find(k => k.startsWith("sb-") && k.endsWith("-auth-token"));
              if (!supabaseKey) return null;
              const raw = localStorage.getItem(supabaseKey);
              if (!raw) return null;
              const parsed = JSON.parse(raw);
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
              if (!token) return null;
              return { token, refreshToken, expiresAt, email };
            } catch {
              return null;
            }
          },
        });

        const payload = results?.[0]?.result;
        if (!payload?.token) {
          sendResponse({ success: false, error: "SESSION_NOT_FOUND_ON_DASHBOARD" });
          return;
        }

        chrome.storage.local.set({
          fyjob_token: payload.token,
          fyjob_user_email: payload.email || "",
          fyjob_refresh_token: payload.refreshToken || "",
          fyjob_expires_at: payload.expiresAt || null,
        }, () => {
          sendResponse({ success: true });
        });
      } catch (e) {
        sendResponse({ success: false, error: e?.message || "SYNC_AUTH_FAILED" });
      }
    })();

    return true;
  }

  if (message.type === "SYNC_LOGOUT") {
    chrome.storage.local.remove(["fyjob_token", "fyjob_user_email", "fyjob_refresh_token", "fyjob_expires_at"], () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "REFRESH_AUTH_TOKEN") {
    refreshAuthTokenFromStorage().then((result) => sendResponse(result));
    return true;
  }

  if (message.type === "LOGOUT") {
    // 1. Clear extension storage
    chrome.storage.local.remove(["fyjob_token", "fyjob_user_email", "fyjob_refresh_token", "fyjob_expires_at"], () => {
      sendResponse({ success: true });
    });

    // 2. Also force logout on any open dashboard tabs
    forceWebLogout();

    return true;
  }

  if (message.type === "EXTRACT_JOB") {
    // Find the correct tab, then directly execute the scraper via scripting API
    // This bypasses unreliable content script messaging in Firefox sidebar
    findJobTab().then(tab => {
      if (!tab?.id) {
        sendResponse({ error: "No active job tab found. Pastikan lu lagi buka halaman job portal!" });
        return;
      }

      // Directly inject and execute scraper — no content script messaging needed!
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const url = window.location.href;
          let jobTitle = "";
          let company = "";
          let jobDescription = "";
          let portal = "Unknown";
          const portalByDomain = [
            ["linkedin.com", "LinkedIn"],
            ["indeed.com", "Indeed"],
            ["jobstreet.co.id", "Jobstreet"],
            ["jobstreet.com", "Jobstreet"],
            ["jobsdb.com", "JobsDB"],
            ["kalibrr.com", "Kalibrr"],
            ["glints.com", "Glints"],
            ["karir.com", "Karir.com"],
            ["glassdoor.com", "Glassdoor"],
            ["monster.com", "Monster"],
            ["ziprecruiter.com", "ZipRecruiter"],
            ["simplyhired.com", "SimplyHired"],
            ["dice.com", "Dice"],
            ["wellfound.com", "Wellfound"],
            ["builtin.com", "Built In"],
            ["jobs.lever.co", "Lever"],
            ["lever.co", "Lever"],
            ["greenhouse.io", "Greenhouse"],
            ["boards.greenhouse.io", "Greenhouse"],
            ["ashbyhq.com", "Ashby"],
            ["smartrecruiters.com", "SmartRecruiters"],
            ["workable.com", "Workable"],
            ["myworkdayjobs.com", "Workday"],
            ["workday.com", "Workday"],
            ["jobvite.com", "Jobvite"],
            ["icims.com", "iCIMS"],
            ["taleo.net", "Taleo"],
            ["recruitee.com", "Recruitee"],
            ["join.com", "Join"],
          ];

          if (url.includes("localhost") || url.includes("fyjob")) {
            return { success: false, error: "Cannot scan FYJOB Dashboard. Open a real job portal first!" };
          }

          // LinkedIn
          if (url.includes("linkedin.com")) {
            portal = "LinkedIn";
            jobTitle = document.querySelector("h1.t-24, h1.jobs-unified-top-card__job-title, .job-details-jobs-unified-top-card__job-title")?.textContent?.trim() || "";
            company = document.querySelector(".jobs-unified-top-card__company-name a, .job-details-jobs-unified-top-card__company-name")?.textContent?.trim() || "";
            const descEl = document.querySelector(
              ".jobs-description__content, .jobs-box__html-content, #job-details, .jobs-description-content__text"
            );
            jobDescription = descEl?.innerText?.trim() || "";
          }
          // Indeed
          else if (url.includes("indeed.com")) {
            portal = "Indeed";
            jobTitle = document.querySelector("h1.jobsearch-JobInfoHeader-title, .icl-u-xs-mb--xs h1")?.textContent?.trim() || "";
            company = document.querySelector("[data-testid='inlineHeader-companyName'], .icl-u-lg-mr--sm")?.textContent?.trim() || "";
            jobDescription = document.querySelector("#jobDescriptionText, .jobsearch-jobDescriptionText")?.innerText?.trim() || "";
          }
          // Jobstreet
          else if (url.includes("jobstreet")) {
            portal = "Jobstreet";
            jobTitle = document.querySelector("h1[data-automation='job-detail-title'], h1")?.textContent?.trim() || "";
            company = document.querySelector("[data-automation='advertiser-name'], .company")?.textContent?.trim() || "";
            jobDescription = document.querySelector("[data-automation='jobAdDetails'], .job-description")?.innerText?.trim() || "";
          }
          // Kalibrr
          else if (url.includes("kalibrr.com")) {
            portal = "Kalibrr";
            jobTitle = document.querySelector("h1.css-14kcftp, h1")?.textContent?.trim() || "";
            company = document.querySelector(".css-1mg76ol a, .company-name")?.textContent?.trim() || "";
            jobDescription = document.querySelector(".css-1uaxr1c, .job-description, .k-prose")?.innerText?.trim() || "";
          }
          // Glints
          else if (url.includes("glints.com")) {
            portal = "Glints";
            jobTitle = document.querySelector("h1")?.textContent?.trim() || "";
            company = document.querySelector("a[href*='/companies/']")?.textContent?.trim() || "";
            const descContainers = document.querySelectorAll("[class*='Description'], [class*='description'], article");
            jobDescription = Array.from(descContainers).map(el => el.innerText?.trim()).join("\n\n") || "";
          }

          // Generic fallback
          if (!jobDescription) {
            if (portal === "Unknown") {
              const byDomain = portalByDomain.find(([domain]) => url.includes(domain));
              portal = byDomain ? byDomain[1] : new URL(url).hostname.replace("www.", "");
            }
            jobTitle = jobTitle || document.querySelector("h1")?.textContent?.trim() || document.title;
            const commonSelectors = [
              "article", ".job-description", "#job-description",
              "[class*='description']", "[class*='job-detail']",
              ".posting-page", ".content-area", "main"
            ];
            for (const sel of commonSelectors) {
              const el = document.querySelector(sel);
              if (el && el.innerText.length > 200) { jobDescription = el.innerText.trim(); break; }
            }
            if (!jobDescription || jobDescription.length < 100) {
              jobDescription = document.body.innerText.substring(0, 5000);
            }
          }

          return {
            success: true,
            data: {
              jobTitle: jobTitle.substring(0, 200),
              company: company.substring(0, 100),
              jobDescription: jobDescription.substring(0, 8000),
              portal,
              url
            }
          };
        }
      }).then(results => {
        if (results && results[0] && results[0].result) {
          sendResponse(results[0].result);
        } else {
          sendResponse({ success: false, error: "Failed to extract job data from tab." });
        }
      }).catch(err => {
        console.error("[FYJOB BG] executeScript error:", err);
        sendResponse({ success: false, error: "Cannot access tab: " + (err.message || "Permission denied") });
      });

    }).catch(err => {
      sendResponse({ error: "Tab query failed: " + err.message });
    });

    return true;
  }
});

// ─── Helper: find the active job portal tab, with Firefox sidebar fallback ───
async function findJobTab() {
  const isJobSite = (url) => isJobPortalUrl(url);

  // Try 1: active tab in last focused window — but ONLY if it's a job portal
  let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tabs[0]?.id && isJobSite(tabs[0].url)) return tabs[0];

  // Try 2: any active tab that is a job portal (Firefox sidebar fallback)
  tabs = await chrome.tabs.query({ active: true });
  let portalTab = tabs.find(t => isJobSite(t.url));
  if (portalTab) return portalTab;

  // Try 3: any tab that is a job portal (last resort — picks most recent)
  tabs = await chrome.tabs.query({});
  portalTab = tabs.find(t => isJobSite(t.url));
  if (portalTab) return portalTab;

  // Try 4: if nothing matched, return whatever active tab we have (will show a clear error)
  tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
}

async function findDashboardTab() {
  const allTabs = await chrome.tabs.query({});
  const isDashboardUrl = (url) => {
    if (!url) return false;
    return url.includes("localhost:3000")
      || url.includes("127.0.0.1:3000")
      || url.includes("localhost:5173")
      || url.includes("127.0.0.1:5173")
      || url.includes("vercel.app")
      || url.includes("fyjob");
  };

  const isProductionDashboardUrl = (url) => {
    if (!url) return false;
    return url.includes("fyjob") || url.includes("vercel.app");
  };

  const preferredProd = allTabs.find(t => isProductionDashboardUrl(t.url) && (t.active || /\/auth|\/dashboard|#access_token/.test(t.url)));
  if (preferredProd) return preferredProd;

  const anyProd = allTabs.find(t => isProductionDashboardUrl(t.url));
  if (anyProd) return anyProd;

  const preferred = allTabs.find(t => isDashboardUrl(t.url) && (t.active || /\/auth|\/dashboard|#access_token/.test(t.url)));
  if (preferred) return preferred;
  return allTabs.find(t => isDashboardUrl(t.url)) || null;
}

// ─── Helper: force logout on all open dashboard tabs ───
async function forceWebLogout() {
  try {
    const dashboardPatterns = ["localhost", "fyjob", "vercel.app"];
    const allTabs = await chrome.tabs.query({});
    const dashTabs = allTabs.filter(t => t.url && dashboardPatterns.some(p => t.url.includes(p)));

    for (const tab of dashTabs) {
      // Try sending message to content script first (fastest)
      try {
        chrome.tabs.sendMessage(tab.id, { type: "FORCE_WEB_LOGOUT" });
      } catch (e) {
        // Content script might not be ready — use executeScript fallback
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const keys = Object.keys(localStorage);
              keys.forEach(k => {
                if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
                  localStorage.removeItem(k);
                }
              });
              localStorage.removeItem("fyjob_auth_bridge_v1");
              window.location.reload();
            }
          });
        } catch (e2) {
          console.warn("[FYJOB BG] Could not force logout on tab:", tab.id, e2);
        }
      }
    }
  } catch (e) {
    console.warn("[FYJOB BG] forceWebLogout error:", e);
  }
}

