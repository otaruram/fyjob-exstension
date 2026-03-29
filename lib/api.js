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

async function apiRequest(endpoint, method = "GET", body = null) {
  const token = await getAuthToken();
  if (!token) {
    throw new Error("NOT_AUTHENTICATED");
  }

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  };

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${endpoint}`, options);
  
  if (res.status === 401) throw new Error("NOT_AUTHENTICATED");
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
