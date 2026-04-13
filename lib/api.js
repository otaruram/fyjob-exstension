/**
 * FYJOB Extension — API Client
 * Communicates with Azure Functions backend
 */

const DEFAULT_API_BASES = [
  "https://www.fyjob.my.id/api",
  "https://fyjob.my.id/api",
  "https://fypodku-g4f2avb0aaewcyaw.indonesiacentral-01.azurewebsites.net/api",
];

let lastHealthyBase = DEFAULT_API_BASES[0];
let cachedApiBases = null;
let cachedApiBasesAt = 0;

function requestRuntime(type) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type }, (res) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(res || null);
    });
  });
}

function normalizeApiBase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutSlash = raw.replace(/\/$/, "");
  return withoutSlash.endsWith("/api") ? withoutSlash : `${withoutSlash}/api`;
}

async function getConfiguredApiBases() {
  const now = Date.now();
  if (cachedApiBases && now - cachedApiBasesAt < 60_000) {
    return cachedApiBases;
  }

  try {
    const config = await chrome.storage.local.get([
      "fyjob_api_bases",
      "fyjob_api_base",
      "fyjob_dashboard_url",
    ]);
    const fromList = Array.isArray(config?.fyjob_api_bases) ? config.fyjob_api_bases : [];
    const fromSingle = config?.fyjob_api_base ? [config.fyjob_api_base] : [];
    const fromDashboard = config?.fyjob_dashboard_url ? [config.fyjob_dashboard_url] : [];
    const merged = [...fromList, ...fromSingle, ...fromDashboard, ...DEFAULT_API_BASES]
      .map(normalizeApiBase)
      .filter(Boolean);
    cachedApiBases = [...new Set(merged)];
  } catch {
    cachedApiBases = DEFAULT_API_BASES;
  }

  cachedApiBasesAt = now;
  return cachedApiBases;
}

async function getAuthToken() {
  const response = await requestRuntime("GET_AUTH_TOKEN");
  return response?.token || null;
}

async function tryRefreshToken() {
  const response = await requestRuntime("REFRESH_AUTH_TOKEN");
  if (!response?.success || !response?.token) return null;
  return response.token;
}

async function trySyncFromDashboard() {
  const response = await requestRuntime("SYNC_AUTH_NOW");
  if (!response?.success) return null;
  // Wait briefly for storage to update, then read the new token
  await new Promise((r) => setTimeout(r, 300));
  return getAuthToken();
}

async function getBaseOrder() {
  const bases = await getConfiguredApiBases();
  const ordered = [lastHealthyBase, ...bases];
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

function buildRequestOptions(method, jwt, body) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${jwt}`,
    },
  };

  if (body) options.body = JSON.stringify(body);
  return options;
}

async function tryAcrossBases(endpoint, options) {
  let sawUnauthorized = false;
  let sawNonJson = false;
  let lastHttpError = null;

  const baseOrder = await getBaseOrder();
  for (const base of baseOrder) {
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
}

async function apiRequest(endpoint, method = "GET", body = null) {
  let token = await getAuthToken();
  if (!token) {
    throw new Error("NOT_AUTHENTICATED");
  }

  const options = buildRequestOptions(method, token, body);
  let result = await tryAcrossBases(endpoint, options);

  if (result.ok) return result.data;

  if (result.sawUnauthorized) {
    let refreshedToken = await tryRefreshToken();
    if (!refreshedToken) {
      refreshedToken = await trySyncFromDashboard();
    }
    if (!refreshedToken) throw new Error("NOT_AUTHENTICATED");

    token = refreshedToken;
    const retryOptions = buildRequestOptions(method, token, body);
    result = await tryAcrossBases(endpoint, retryOptions);
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
