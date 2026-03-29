/**
 * FYJOB Extension — Background Service Worker
 * Handles: Side panel lifecycle, auth token relay, content script communication
 */

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

// Enable side panel on supported job portal tabs
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  const jobPortals = [
    "linkedin.com", "indeed.com", "jobstreet.co.id",
    "kalibrr.com", "glints.com", "karir.com",
    "lever.co", "greenhouse.io", "workday.com"
  ];

  const isJobSite = jobPortals.some(p => tab.url.includes(p));
  
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: true
    });
  } catch (e) {
    // Side panel API may not be available in all contexts
  }
});

// Listen for messages from content scripts and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SAVE_AUTH_TOKEN") {
    chrome.storage.local.set({ 
      fyjob_token: message.token,
      fyjob_user_email: message.email || ""
    }, () => {
      sendResponse({ success: true });
    });
    return true; // Keep channel open for async response
  }

  if (message.type === "GET_AUTH_TOKEN") {
    chrome.storage.local.get(["fyjob_token", "fyjob_user_email"], (data) => {
      sendResponse({ 
        token: data.fyjob_token || null,
        email: data.fyjob_user_email || ""
      });
    });
    return true;
  }

  if (message.type === "EXTRACT_JOB") {
    // Forward to content script in active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        sendResponse({ error: "No active tab found" });
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: "SCRAPE_JOB" }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: "Content script not ready. Reload the page." });
        } else {
          sendResponse(response);
        }
      });
    });
    return true;
  }

  if (message.type === "LOGOUT") {
    chrome.storage.local.remove(["fyjob_token", "fyjob_user_email"], () => {
      sendResponse({ success: true });
    });
    return true;
  }
});
