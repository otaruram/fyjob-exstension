/**
 * FYJOB Extension — API Client
 * Communicates with Azure Functions backend
 */

const API_BASES = [
  "https://www.fyjob.my.id/api",
  "https://fyjob.my.id/api",
  "https://fypodku-g4f2avb0aaewcyaw.indonesiacentral-01.azurewebsites.net/api",
];

let lastHealthyBase = API_BASES[0];

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

async function trySyncFromDashboard() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "SYNC_AUTH_NOW" }, async (res) => {
      if (chrome.runtime.lastError || !res?.success) {
        resolve(null);
        return;
      }
      // Wait briefly for storage to update, then read the new token
      await new Promise((r) => setTimeout(r, 300));
      const token = await getAuthToken();
      resolve(token);
    });
  });
}

function getBaseOrder() {
  const ordered = [lastHealthyBase, ...API_BASES];
  return [...new Set(ordered)];
}

async function requestWithBase(baseUrl, endpoint, options) {
  const response = await fetch(`${baseUrl}${endpoint}`, options);
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const rawText = await response.text();
  const trimmed = rawText.trim();
  const isJsonLike = contentType.includes("application/json") || trimmed.startsWith("{") || trimmed.startsWith("[");

  if (!isJsonLike) {
    return {
      response,
      data: null,
      nonJson: true,
    };
  }

  let data = null;
  try {
    data = trimmed ? JSON.parse(trimmed) : {};
  } catch {
    return {
      response,
      data: null,
      nonJson: true,
    };
  }

  return {
    response,
    data,
    nonJson: false,
  };
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

  const tryAcrossBases = async (jwt) => {
    const options = { method, headers: makeHeaders(jwt) };
    if (body) options.body = JSON.stringify(body);

    let sawUnauthorized = false;
    let sawNonJson = false;
    let lastHttpError = null;

    for (const base of getBaseOrder()) {
      let result;
      try {
        result = await requestWithBase(base, endpoint, options);
      } catch {
        continue;
      }

      const { response, data, nonJson } = result;

      if (nonJson) {
        sawNonJson = true;
        continue;
      }

      if (response.status === 401) {
        sawUnauthorized = true;
        continue;
      }

      if (response.status === 403) {
        throw new Error("NO_CREDITS");
      }

      if (!response.ok) {
        lastHttpError = data?.error || `API Error ${response.status}`;
        continue;
      }

      lastHealthyBase = base;
      return { ok: true, data };
    }

    return {
      ok: false,
      sawUnauthorized,
      sawNonJson,
      lastHttpError,
    };
  };

  let result = await tryAcrossBases(token);

  if (result.ok) return result.data;

  if (result.sawUnauthorized) {
    let refreshedToken = await tryRefreshToken();
    if (!refreshedToken) {
      refreshedToken = await trySyncFromDashboard();
    }
    if (!refreshedToken) throw new Error("NOT_AUTHENTICATED");

    token = refreshedToken;
    result = await tryAcrossBases(token);
    if (result.ok) return result.data;
    if (result.sawUnauthorized) throw new Error("NOT_AUTHENTICATED");
  }

  if (result.lastHttpError) {
    throw new Error(result.lastHttpError);
  }

  if (result.sawNonJson) {
    throw new Error("API route salah: domain merespons HTML, bukan JSON.");
  }

  throw new Error("Tidak bisa terhubung ke API. Cek jaringan atau endpoint backend.");
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
