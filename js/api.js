(function () {
  const base = (window.NEXUS_CONFIG && window.NEXUS_CONFIG.API_BASE_URL || "").replace(/\/+$/, "");

  async function request(path, options) {
    const config = options || {};
    const headers = new Headers(config.headers || {});
    if (config.token) headers.set("Authorization", `Bearer ${config.token}`);
    if (config.body && !(config.body instanceof Blob) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(`${base}${path}`, {
      method: config.method || "GET",
      headers,
      body: config.body instanceof Blob ? config.body : (config.body ? JSON.stringify(config.body) : undefined),
    });
    const type = response.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await response.json() : null;
    if (!response.ok) {
      const message = data && (data.detail || data.message) || `Request failed (${response.status})`;
      throw new Error(typeof message === "string" ? message : JSON.stringify(message));
    }
    return data;
  }

  window.NexusAPI = Object.freeze({
    baseUrl: base,
    health: () => request("/api/health"),
    serverStatus: () => request("/api/server/status"),
    checkServer: () => request("/api/server/check", { method: "POST" }),
    wakeServer: () => request("/api/server/wake", { method: "POST" }),
    validateYoutube: (url) => request("/api/youtube/validate", { method: "POST", body: { url } }),
    initializeUpload: (file) => request("/api/upload/init", {
      method: "POST",
      body: { filename: file.name, size_bytes: file.size, content_type: file.type || "application/octet-stream" },
    }),
    uploadFile: (upload, file) => fetch(upload.upload_url, {
      method: "PUT",
      headers: upload.required_headers,
      body: file,
    }).then((response) => {
      if (!response.ok) throw new Error(`Storage upload failed (${response.status}). Check the R2 bucket CORS configuration.`);
    }),
    createYoutubeJob: (url, settings) => request("/api/jobs", {
      method: "POST",
      body: { source_type: "youtube", youtube_url: url, settings },
    }),
    createUploadJob: (upload, settings) => request("/api/jobs", {
      method: "POST",
      body: {
        source_type: "upload",
        upload_id: upload.upload_id,
        upload_token: upload.upload_token,
        settings,
      },
    }),
    job: (jobId, token) => request(`/api/jobs/${encodeURIComponent(jobId)}`, { token }),
    jobStatus: (jobId, token) => request(`/api/jobs/${encodeURIComponent(jobId)}/status`, { token }),
    jobResults: (jobId, token) => request(`/api/jobs/${encodeURIComponent(jobId)}/results`, { token }),
    jobArchive: (jobId, token) => request(`/api/jobs/${encodeURIComponent(jobId)}/download`, { token }),
    cancelJob: (jobId, token) => request(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST", token }),
    retryJob: (jobId, token) => request(`/api/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST", token }),
    deleteJob: (jobId, token) => request(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", token }),
  });
})();
