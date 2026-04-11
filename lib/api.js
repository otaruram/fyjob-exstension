/**
 * FYJOB Extension — API Client
 * Communicates with Azure Functions backend
 */

const API_BASE = "https://fypodku-g4f2avb0aaewcyaw.indonesiacentral-01.azurewebsites.net/api";

async function getAuthToken() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_AUTH_TOKEN" }, (res) => {
      resolve(res?.token || null);
    });
  });
}

async function tryRefreshToken() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "REFRESH_AUTH_TOKEN" }, (res) => {
      if (chrome.runtime.lastError || !res?.success || !res?.token) {
        resolve(null);
        return;
      }
      resolve(res.token);
    });
  });
}

async function apiRequest(endpoint, method = "GET", body = null) {
  let token = await getAuthToken();
  if (!token) {
    throw new Error("NOT_AUTHENTICATED");
  }

  const makeHeaders = (jwt) => ({
    "Content-Type": "application/json",
    "Authorization": `Bearer ${jwt}`
  });

  let options = { method, headers: makeHeaders(token) };
  if (body) options.body = JSON.stringify(body);

  let res = await fetch(`${API_BASE}${endpoint}`, options);

  if (res.status === 401) {
    const refreshedToken = await tryRefreshToken();
    if (!refreshedToken) throw new Error("NOT_AUTHENTICATED");
    token = refreshedToken;
    options = { method, headers: makeHeaders(token) };
    if (body) options.body = JSON.stringify(body);
    res = await fetch(`${API_BASE}${endpoint}`, options);
    if (res.status === 401) throw new Error("NOT_AUTHENTICATED");
  }

  if (res.status === 403) throw new Error("NO_CREDITS");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API Error ${res.status}`);
  }
  
  return res.json();
}

// ─── Public API ───

async function getUserStats() {
  return apiRequest("/user-stats");
}

async function analyzeJob(jobData) {
  return apiRequest("/analyze", "POST", jobData);
}

async function chatWithUjang(message, analysisId, conversationHistory = []) {
  return apiRequest("/chat", "POST", {
    message,
    analysisId,
    conversationHistory
  });
}

async function getAnalysisHistory(limit = 5) {
  return apiRequest(`/history?limit=${limit}`);
}
