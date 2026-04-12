const SUPABASE_URL = "https://iplciyfnwwiyjtvrvqza.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_C5rgYqsle-9YyDW1YeG67A_O_x46k5y";
const EXT_AUTH_BRIDGE_KEY = "fyjob_auth_bridge_v1";

const DASHBOARD_MATCHERS = [
  "fyjob.my.id",
  "www.fyjob.my.id",
  "azurewebsites.net",
  "vercel.app",
  "localhost:3000",
  "127.0.0.1:3000",
  "localhost:5173",
  "127.0.0.1:5173",
];

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

function isDashboardUrl(url) {
  return Boolean(url) && DASHBOARD_MATCHERS.some((item) => url.includes(item));
}

function isJobPortalUrl(url) {
  if (!url) return false;
  if (JOB_PORTAL_MATCHERS.some((item) => url.includes(item))) return true;

  // Generic fallback for unknown portals: match common job/career paths
  return /\b(job|jobs|career|careers|vacancy|vacancies|hiring|recruit|position|opening)\b/i.test(url);
}

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

function isTokenExpiringSoon(token, expiresAt, bufferSeconds = 300) {
  const effectiveExpiry = Number(expiresAt) || getJwtExpiration(token);
  if (!effectiveExpiry) return false;
  const now = Math.floor(Date.now() / 1000);
  return effectiveExpiry <= now + bufferSeconds;
}

async function refreshAuthTokenFromStorage() {
  const data = await chrome.storage.local.get(["fyjob_refresh_token"]);
  const refreshToken = data?.fyjob_refresh_token;
  if (!refreshToken) return { success: false, error: "NO_REFRESH_TOKEN" };

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
    const token = payload?.access_token;
    const nextRefresh = payload?.refresh_token || refreshToken;
    const expiresAt = payload?.expires_at || getJwtExpiration(token);
    const email = payload?.user?.email || "";

    if (!token) {
      return { success: false, error: "INVALID_REFRESH_RESPONSE" };
    }

    await chrome.storage.local.set({
      fyjob_token: token,
      fyjob_refresh_token: nextRefresh,
      fyjob_expires_at: expiresAt,
      fyjob_user_email: email,
    });

    return { success: true, token, refreshToken: nextRefresh, expiresAt, email };
  } catch (e) {
    return { success: false, error: e?.message || "REFRESH_ERROR" };
  }
}

async function findDashboardTabs() {
  const allTabs = await chrome.tabs.query({});
  return allTabs
    .filter((tab) => isDashboardUrl(tab?.url || ""))
    .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)));
}

async function extractDashboardSession(tabId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (bridgeKey) => {
      const readBridge = () => {
        try {
          const raw = localStorage.getItem(bridgeKey);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          if (!parsed?.access_token) return null;
          return {
            token: parsed.access_token,
            refreshToken: parsed.refresh_token || "",
            expiresAt: parsed.expires_at || null,
            email: parsed.email || "",
          };
        } catch {
          return null;
        }
      };

      const bridge = readBridge();
      if (bridge?.token) return bridge;

      try {
        const keys = Object.keys(localStorage);
        const supabaseKey = keys.find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
        if (!supabaseKey) return null;
        const raw = localStorage.getItem(supabaseKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const token = parsed?.access_token || parsed?.currentSession?.access_token || parsed?.session?.access_token;
        const refreshToken = parsed?.refresh_token || parsed?.currentSession?.refresh_token || parsed?.session?.refresh_token || "";
        const expiresAt = parsed?.expires_at || parsed?.currentSession?.expires_at || parsed?.session?.expires_at || null;
        const email = parsed?.user?.email || parsed?.currentSession?.user?.email || parsed?.session?.user?.email || "";
        if (!token) return null;
        return { token, refreshToken, expiresAt, email };
      } catch {
        return null;
      }
    },
    args: [EXT_AUTH_BRIDGE_KEY],
  });

  return result?.[0]?.result || null;
}

async function syncAuthFromDashboardTab() {
  const tabs = await findDashboardTabs();
  for (const tab of tabs) {
    if (!tab?.id) continue;
    try {
      const payload = await extractDashboardSession(tab.id);
      if (!payload?.token) continue;
      await chrome.storage.local.set({
        fyjob_token: payload.token,
        fyjob_refresh_token: payload.refreshToken || "",
        fyjob_expires_at: payload.expiresAt || null,
        fyjob_user_email: payload.email || "",
      });
      return { success: true };
    } catch {
      // try next tab
    }
  }
  return { success: false, error: "SESSION_NOT_FOUND_ON_DASHBOARD" };
}

async function openSidePanelForTab(tabId) {
  try {
    if (chrome.sidePanel?.setOptions) {
      await chrome.sidePanel.setOptions({
        tabId,
        path: "sidepanel.html",
        enabled: true,
      });
    }
    if (chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ tabId });
      return true;
    }
  } catch {
    // ignore and try Firefox API
  }

  try {
    if (typeof browser !== "undefined" && browser.sidebarAction?.open) {
      await browser.sidebarAction.open();
      return true;
    }
  } catch {
    // Firefox sidebar not available
  }

  return false;
}

async function configureActionClickBehavior() {
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch {
    // Keep fallback action handler below for browsers without setPanelBehavior support.
  }
}

async function forceWebLogout() {
  const tabs = await findDashboardTabs();
  for (const tab of tabs) {
    if (!tab?.id) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "FORCE_LOGOUT_WEB" });
    } catch {
      // ignore
    }
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  await openSidePanelForTab(tab.id);
});

chrome.runtime.onInstalled.addListener(() => {
  configureActionClickBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  configureActionClickBehavior();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab?.url) {
    if (isJobPortalUrl(tab.url)) {
      chrome.runtime.sendMessage({ type: "TAB_UPDATED", url: tab.url }).catch(() => {});
    }
    if (isDashboardUrl(tab.url)) {
      await syncAuthFromDashboardTab();
    }
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab?.url && isDashboardUrl(tab.url)) {
      await syncAuthFromDashboardTab();
    }
    if (tab?.url && isJobPortalUrl(tab.url)) {
      chrome.runtime.sendMessage({ type: "TAB_UPDATED", url: tab.url }).catch(() => {});
    }
  } catch {
    // ignore
  }
});

chrome.runtime.onStartup?.addListener(() => {
  syncAuthFromDashboardTab();
});

chrome.runtime.onInstalled?.addListener(() => {
  syncAuthFromDashboardTab();
});

function clearStoredAuth(sendResponse) {
  chrome.storage.local.remove(["fyjob_token", "fyjob_refresh_token", "fyjob_expires_at", "fyjob_user_email"], () => {
    sendResponse({ success: true });
  });
}

function handleSaveAuthToken(message, _sender, sendResponse) {
  const expiresAt = message.expiresAt || getJwtExpiration(message.token);
  chrome.storage.local.set({
    fyjob_token: message.token,
    fyjob_refresh_token: message.refreshToken || "",
    fyjob_expires_at: expiresAt || null,
    fyjob_user_email: message.email || "",
  }, () => sendResponse({ success: true }));
  return true;
}

function handleSyncLogout(_message, _sender, sendResponse) {
  clearStoredAuth(sendResponse);
  return true;
}

function handleGetAuthToken(_message, _sender, sendResponse) {
  (async () => {
    const data = await chrome.storage.local.get(["fyjob_token", "fyjob_refresh_token", "fyjob_expires_at", "fyjob_user_email"]);
    const token = data?.fyjob_token || null;
    const shouldRefresh = token
      ? isTokenExpiringSoon(token, data?.fyjob_expires_at)
      : Boolean(data?.fyjob_refresh_token);

    if (shouldRefresh) {
      const refreshed = await refreshAuthTokenFromStorage();
      if (refreshed.success) {
        sendResponse({ token: refreshed.token, email: refreshed.email || "" });
        return;
      }
    }

    sendResponse({ token, email: data?.fyjob_user_email || "" });
  })();
  return true;
}

function handleRefreshAuthToken(_message, _sender, sendResponse) {
  refreshAuthTokenFromStorage().then(sendResponse);
  return true;
}

function handleSyncAuthNow(_message, _sender, sendResponse) {
  syncAuthFromDashboardTab().then(sendResponse);
  return true;
}

function handleLogout(_message, _sender, sendResponse) {
  clearStoredAuth(sendResponse);
  forceWebLogout();
  return true;
}

function handleOpenPanelAndScan(message, sender, sendResponse) {
  (async () => {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: "TAB_NOT_FOUND" });
      return;
    }

    const pendingPayload = {
      jobData: message.jobData || null,
      source: message.source || "unknown",
      sourceUrl: message.sourceUrl || sender?.tab?.url || "",
      requestedAt: Date.now(),
    };

    await chrome.storage.local.set({
      fyjob_pending_scan_job: pendingPayload,
    });

    const opened = await openSidePanelForTab(tabId);
    sendResponse({ success: opened });
  })();
  return true;
}

function handleConsumePendingScan(_message, _sender, sendResponse) {
  chrome.storage.local.get(["fyjob_pending_scan_job"], (data) => {
    const payload = data?.fyjob_pending_scan_job || null;
    chrome.storage.local.remove(["fyjob_pending_scan_job"], () => {
      sendResponse({ success: true, payload });
    });
  });
  return true;
}

function handleExtractJob(_message, _sender, sendResponse) {
  (async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const activeTab = tabs?.[0];
      if (!activeTab?.id || !isJobPortalUrl(activeTab.url || "")) {
        sendResponse({ success: false, error: "Buka halaman job portal dulu." });
        return;
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
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

          if (!jobDescription || jobDescription.length < 80) {
            return { success: false, error: "Deskripsi job belum kebaca. Scroll halaman lalu coba lagi." };
          }

          return {
            success: true,
            jobData: {
              jobTitle: jobTitle || "Unknown Position",
              company: company || "Unknown Company",
              portal,
              url,
              jobDescription,
            },
          };
        },
      });

      sendResponse(results?.[0]?.result || { success: false, error: "Gagal extract job" });
    } catch (e) {
      sendResponse({ success: false, error: e?.message || "Gagal extract job" });
    }
  })();
  return true;
}

const MESSAGE_HANDLERS = {
  SAVE_AUTH_TOKEN: handleSaveAuthToken,
  SYNC_LOGOUT: handleSyncLogout,
  GET_AUTH_TOKEN: handleGetAuthToken,
  REFRESH_AUTH_TOKEN: handleRefreshAuthToken,
  SYNC_AUTH_NOW: handleSyncAuthNow,
  LOGOUT: handleLogout,
  OPEN_PANEL_AND_SCAN: handleOpenPanelAndScan,
  CONSUME_PENDING_SCAN: handleConsumePendingScan,
  EXTRACT_JOB: handleExtractJob,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = MESSAGE_HANDLERS[message?.type];
  if (!handler) return false;
  return handler(message, sender, sendResponse);
});
