(function () {
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const storageKey = "nexus.savedJobs.v1";
  const pageTitles = {
    dashboard: "Dashboard", create: "Create Shorts", server: "Server Control",
    projects: "My Projects", history: "Download History", settings: "Settings", about: "About",
  };
  let jobs = loadJobs();
  let sourceMode = "youtube";
  let selectedFile = null;
  let youtubeVideoId = null;
  let currentJob = null;
  let server = { state: "OFFLINE", mode: "free-testing" };
  let toastTimer;
  let objectUrl = null;

  function loadJobs() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter((item) => item && item.jobId && item.token) : [];
    } catch (error) {
      console.error("Could not read saved job list", error);
      return [];
    }
  }

  function saveJobs() {
    const stored = jobs.map((job) => ({
      ...job,
      results: Array.isArray(job.results)
        ? job.results.map(({ download_url, ...item }) => item)
        : job.results,
    }));
    localStorage.setItem(storageKey, JSON.stringify(stored));
  }

  function notify(message, type) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.className = `toast show ${type || ""}`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.className = "toast"; }, 4200);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char]));
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) ? url.href : "#";
    } catch (error) {
      return "#";
    }
  }

  function showPage(page) {
    if (!pageTitles[page]) return;
    $$(".page").forEach((section) => section.classList.toggle("active", section.id === `page-${page}`));
    $$(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
    $("#page-title").textContent = pageTitles[page];
    $("#sidebar").classList.remove("open");
    if (page === "projects" || page === "history") renderSavedJobs();
    if (page === "server") refreshServerStatus();
  }

  function statusClass(state) {
    return String(state || "").toLowerCase().replace(/\s+/g, "-");
  }

  function setStatusIndicators(status) {
    server = status;
    const online = ["ONLINE", "BUSY"].includes(status.state);
    const waiting = status.state === "WAKING UP";
    $("#top-status-text").textContent = status.state || "ERROR";
    $("#top-status-dot").className = `status-dot ${online ? "online" : waiting ? "waiting" : "offline"}`;
    $("#quick-status").textContent = status.state || "ERROR";
    $("#quick-status-dot").className = `status-dot ${online ? "online" : waiting ? "waiting" : "offline"}`;
    $("#quick-mode").textContent = status.mode === "reliable" ? "Reliable Processing Mode" : "Free Testing Mode";
    $("#sidebar-mode").textContent = status.mode === "reliable" ? "Reliable Processing" : "Free Testing Mode";
    $("#dashboard-service").textContent = status.state || "ERROR";
    $("#dashboard-mode").textContent = status.mode === "reliable" ? "Paid worker deployment" : "Cold starts may occur";
    $("#create-mode-badge").textContent = status.mode === "reliable" ? "RELIABLE MODE" : "FREE TESTING MODE";
    $("#server-mode-badge").textContent = status.mode === "reliable" ? "RELIABLE PROCESSING" : "FREE TESTING MODE";
    $("#server-state-chip").textContent = status.state || "ERROR";
    $("#server-state-chip").className = `status-chip ${statusClass(status.state)}`;
    $("#server-state").textContent = status.state || "ERROR";
    $("#server-message").textContent = status.message || "No status details are available.";
    $("#server-latency").textContent = status.response_time_ms == null ? "—" : `${status.response_time_ms} ms`;
    $("#server-last-check").textContent = status.last_successful_health_check
      ? new Date(status.last_successful_health_check).toLocaleString()
      : "Not available";
    $("#worker-health-label").textContent = online ? "Healthy" : waiting ? "Starting" : "Not healthy";
    $("#server-orb").className = `server-orb ${online ? "online" : waiting ? "waiting" : "offline"}`;
    $("#server-mode-note").textContent = status.mode === "reliable"
      ? "A paid background worker cannot be started or stopped through this page. Its status comes from persistent worker heartbeats."
      : "Health-based wake-up requires RENDER_HEALTH_URL. Free services can have cold-start delays and are not intended for reliable long renders.";
    $("#server-info-title").textContent = status.mode === "reliable" ? "Reliable Processing Mode" : "Free Testing Mode";
    $("#server-info-copy").textContent = status.mode === "reliable"
      ? "A paid Render Background Worker processes queued jobs. This UI reports its heartbeat and workload; it does not pretend to power the worker on or off."
      : "A health request can wake a sleeping Render Free Web Service. Cold starts may take a while, and this mode is for short tests only.";
    $("#long-job-label").textContent = status.mode === "reliable" ? "Supported by worker" : "Not reliable";
    const wakeSupported = status.mode === "free-testing" && status.wake_supported === true;
    $("#start-server").disabled = status.mode === "reliable" || online || !wakeSupported;
    $("#start-server").textContent = status.mode === "reliable"
      ? "Worker is provider-managed"
      : (online ? "Service is online" : (wakeSupported ? "Start / Wake service" : "Wake not configured"));
    $("#retry-server").classList.toggle("hidden", !(waiting || status.state === "ERROR" || (status.state === "OFFLINE" && (status.mode === "reliable" || wakeSupported))));
    updateLaunchAvailability();
  }

  async function refreshServerStatus(probe) {
    try {
      setStatusIndicators(probe ? await NexusAPI.checkServer() : await NexusAPI.serverStatus());
    } catch (error) {
      setStatusIndicators({ state: "ERROR", mode: server.mode, message: error.message });
      notify(`Could not check server status: ${error.message}`, "error");
    }
  }

  async function wakeServer() {
    $("#start-server").disabled = true;
    try {
      setStatusIndicators(await NexusAPI.wakeServer());
      pollServerUntilReady();
    } catch (error) {
      notify(`Could not start the health request: ${error.message}`, "error");
      $("#start-server").disabled = false;
    }
  }

  function pollServerUntilReady() {
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      try {
        const status = await NexusAPI.checkServer();
        setStatusIndicators(status);
        if (["ONLINE", "BUSY", "ERROR", "OFFLINE"].includes(status.state) || attempts >= 60) {
          window.clearInterval(timer);
        }
      } catch (error) {
        if (attempts >= 60) window.clearInterval(timer);
      }
    }, 4000);
  }

  function updateLaunchAvailability() {
    const isOnline = ["ONLINE", "BUSY"].includes(server.state);
    const clipCount = $("#clip-count").value === "custom" ? Number($("#custom-count").value) : Number($("#clip-count").value);
    const modeAllowsJob = server.mode !== "free-testing" || clipCount <= 5;
    const customValid = $("#clip-count").value !== "custom" || (clipCount >= 1 && clipCount <= 20);
    const durationValid = $("#clip-duration").value !== "custom"
      || (Number($("#custom-duration").value) >= 1 && Number($("#custom-duration").value) <= 180);
    const rangeValid = $("#clip-duration").value !== "range"
      || (Number($("#range-start").value) >= 0 && Number($("#range-end").value) > Number($("#range-start").value));
    $("#launch-job").disabled = !isOnline || !modeAllowsJob || !customValid || !durationValid || !rangeValid || (sourceMode === "upload" ? !selectedFile : !youtubeVideoId);
    if (server.mode === "free-testing" && clipCount > 5) {
      $("#launch-job").title = "Free Testing Mode is limited to five clips per job.";
    } else {
      $("#launch-job").removeAttribute("title");
    }
  }

  function sourceSettings() {
    const duration = $("#clip-duration").value;
    const count = $("#clip-count").value === "custom" ? Number($("#custom-count").value) : Number($("#clip-count").value);
    return {
      clip_count: count,
      clip_duration: duration === "automatic" || duration === "range" ? null : (duration === "custom" ? Number($("#custom-duration").value) : Number(duration)),
      source_max_height: Number($("#source-resolution").value),
      output_quality: $("#quality").value,
      layout: $("#layout").value,
      fps: 30,
      normalize_audio: $("#audio").value === "normalize",
      start_seconds: duration === "range" ? Number($("#range-start").value) : null,
      end_seconds: duration === "range" ? Number($("#range-end").value) : null,
      crf: 20,
      preset: "veryfast",
    };
  }

  async function launchJob() {
    const button = $("#launch-job");
    button.disabled = true;
    button.innerHTML = "<span class='spinner'></span> Preparing your job…";
    try {
      let response;
      let sourceName;
      if (sourceMode === "youtube") {
        response = await NexusAPI.createYoutubeJob($("#youtube-url").value.trim(), sourceSettings());
        sourceName = `YouTube ${youtubeVideoId}`;
      } else {
        const upload = await NexusAPI.initializeUpload(selectedFile);
        await NexusAPI.uploadFile(upload, selectedFile);
        response = await NexusAPI.createUploadJob(upload, sourceSettings());
        sourceName = selectedFile.name;
      }
      const entry = {
        jobId: response.job_id,
        token: response.access_token,
        sourceName,
        createdAt: new Date().toISOString(),
      };
      jobs.unshift(entry);
      jobs = jobs.slice(0, 40);
      saveJobs();
      currentJob = entry;
      renderCurrentJob({ job_id: response.job_id, state: response.state, progress: 0, completed_clips: 0, requested_clips: sourceSettings().clip_count, current_step: "Waiting for worker" });
      renderSavedJobs();
      notify("Job created. The worker will pick it up shortly.", "success");
      pollJob(entry);
    } catch (error) {
      notify(`Could not create job: ${error.message}`, "error");
    } finally {
      button.innerHTML = "<span>✦</span> Create clipping job";
      updateLaunchAvailability();
    }
  }

  function renderCurrentJob(status) {
    $("#job-placeholder").classList.add("hidden");
    $("#job-progress").classList.remove("hidden");
    $("#job-panel-title").textContent = status.state;
    $("#job-id-value").textContent = status.job_id || (currentJob && currentJob.jobId);
    $("#job-source-name").textContent = (currentJob && currentJob.sourceName) || status.source_name || "—";
    $("#job-requested").textContent = status.requested_clips || "—";
    $("#job-step").textContent = status.current_step || "—";
    $("#job-count").textContent = `${status.completed_clips || 0} / ${status.requested_clips || 0}`;
    $("#job-progress-bar").style.width = `${Math.max(0, Math.min(100, Number(status.progress) || 0))}%`;
    $("#job-percent").textContent = `${Math.round(Math.max(0, Math.min(100, Number(status.progress) || 0)))}%`;
    $("#job-error").textContent = status.error || "";
    $("#job-error").classList.toggle("hidden", !status.error);
    $("#cancel-job").classList.toggle("hidden", ["COMPLETED", "FAILED", "CANCELLED"].includes(status.state));
    $("#retry-job").classList.toggle("hidden", status.state !== "FAILED");
    if (status.state === "COMPLETED" && currentJob) loadJobResults(currentJob);
  }

  async function pollJob(entry) {
    let status;
    try {
      status = await NexusAPI.jobStatus(entry.jobId, entry.token);
      updateSavedEntry(entry.jobId, { state: status.state, completedClips: status.completed_clips, requestedClips: status.requested_clips });
      if (currentJob && currentJob.jobId === entry.jobId) renderCurrentJob(status);
      renderSavedJobs();
      if (!["COMPLETED", "FAILED", "CANCELLED"].includes(status.state)) {
        window.setTimeout(() => pollJob(entry), 3500);
      }
    } catch (error) {
      updateSavedEntry(entry.jobId, { localError: error.message });
      if (currentJob && currentJob.jobId === entry.jobId) {
        renderCurrentJob({ ...status, job_id: entry.jobId, state: "CONNECTION ERROR", error: error.message });
      }
    }
  }

  function updateSavedEntry(jobId, values) {
    const entry = jobs.find((item) => item.jobId === jobId);
    if (entry) Object.assign(entry, values);
    saveJobs();
  }

  async function loadJobResults(entry) {
    if (entry.resultsLoaded) return;
    entry.resultsLoaded = true;
    try {
      const data = await NexusAPI.jobResults(entry.jobId, entry.token);
      entry.results = data.results;
      saveJobs();
      renderCurrentResults(entry.results);
      renderSavedJobs();
    } catch (error) {
      entry.resultsLoaded = false;
      notify(`Could not load download links: ${error.message}`, "error");
    }
  }

  function renderCurrentResults(results) {
    const container = $("#job-results");
    if (!Array.isArray(results)) return;
    container.innerHTML = results.map((item) => {
      const href = safeHttpUrl(item.download_url);
      return `<a class="result-link" href="${escapeHtml(href)}" data-job-id="${escapeHtml(currentJob.jobId)}" data-object-key="${escapeHtml(item.object_key)}" target="_blank" rel="noopener noreferrer">${item.kind === "archive" ? "↓ Download all (ZIP)" : `↓ ${escapeHtml(item.filename)}`}</a>`;
    }).join("");
    container.classList.remove("hidden");
  }

  async function cancelCurrentJob() {
    if (!currentJob) return;
    try {
      await NexusAPI.cancelJob(currentJob.jobId, currentJob.token);
      notify("Cancellation requested.", "success");
      pollJob(currentJob);
    } catch (error) { notify(error.message, "error"); }
  }

  async function retryCurrentJob() {
    if (!currentJob) return;
    try {
      await NexusAPI.retryJob(currentJob.jobId, currentJob.token);
      notify("Job queued for retry.", "success");
      pollJob(currentJob);
    } catch (error) { notify(error.message, "error"); }
  }

  function timeAgo(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown date";
    return date.toLocaleString();
  }

  function jobCard(job) {
    const state = job.state || "Checking";
    return `<article class="project-row">
      <div class="project-icon">▣</div><div class="project-info"><b>${escapeHtml(job.sourceName || "Video project")}</b><small>${escapeHtml(job.jobId)} · ${escapeHtml(timeAgo(job.createdAt))}</small></div>
      <span class="job-state ${statusClass(state)}">${escapeHtml(state)}</span>
      <span class="project-count">${job.completedClips || 0}/${job.requestedClips || "—"} clips</span>
      <button class="text-button project-open" data-open-job="${escapeHtml(job.jobId)}">Details</button>
    </article>`;
  }

  function downloadRow(job, item) {
    const url = safeHttpUrl(item.download_url || "");
    const action = url === "#"
      ? '<button class="button button-secondary compact-button" disabled>Link unavailable</button>'
      : `<a class="button button-secondary compact-button" href="${escapeHtml(url)}" data-job-id="${escapeHtml(job.jobId)}" data-object-key="${escapeHtml(item.object_key)}" target="_blank" rel="noopener noreferrer">Download ↗</a>`;
    return `<article class="download-row"><div class="file-icon">${item.kind === "archive" ? "ZIP" : "MP4"}</div><div class="download-info"><b>${escapeHtml(item.filename)}</b><small>${escapeHtml(job.sourceName || "Video project")} · ${escapeHtml(timeAgo(job.createdAt))}</small></div>${action}</article>`;
  }

  async function refreshDownloadLink(event) {
    const link = event.target.closest("a[data-job-id][data-object-key]");
    if (!link) return;
    const entry = jobs.find((item) => item.jobId === link.dataset.jobId);
    if (!entry) return;
    event.preventDefault();
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const data = await NexusAPI.jobResults(entry.jobId, entry.token);
      const result = data.results.find((item) => item.object_key === link.dataset.objectKey);
      if (!result) throw new Error("The requested output is no longer available.");
      const target = safeHttpUrl(result.download_url);
      if (target === "#") throw new Error("The API returned an invalid download URL.");
      if (popup) popup.location.href = target;
      else window.location.href = target;
    } catch (error) {
      if (popup) popup.close();
      notify(`Could not create download link: ${error.message}`, "error");
    }
  }

  async function populateJobDetails() {
    await Promise.all(jobs.map(async (entry) => {
      try {
        const status = await NexusAPI.jobStatus(entry.jobId, entry.token);
        Object.assign(entry, {
          state: status.state,
          completedClips: status.completed_clips,
          requestedClips: status.requested_clips,
          currentStep: status.current_step,
          error: status.error,
        });
        if (status.state === "COMPLETED") {
          const result = await NexusAPI.jobResults(entry.jobId, entry.token);
          entry.results = result.results;
        }
      } catch (error) {
        entry.localError = error.message;
      }
    }));
    saveJobs();
    renderSavedJobs();
    renderDashboard();
  }

  function renderSavedJobs() {
    const projects = $("#projects-list");
    const history = $("#history-list");
    if (!jobs.length) {
      projects.innerHTML = '<div class="empty-state">No projects yet. Create a job to see it here.</div>';
      history.innerHTML = '<div class="empty-state">No completed downloads yet.</div>';
      return;
    }
    projects.innerHTML = jobs.map(jobCard).join("");
    const rows = jobs.flatMap((job) => (job.results || []).map((item) => downloadRow(job, item)));
    history.innerHTML = rows.length ? rows.join("") : '<div class="empty-state">No completed download links yet.</div>';
    $$(".project-open").forEach((button) => button.addEventListener("click", () => openJob(button.dataset.openJob)));
  }

  function renderDashboard() {
    const completed = jobs.filter((job) => job.state === "COMPLETED");
    const active = jobs.filter((job) => job.state && !["COMPLETED", "FAILED", "CANCELLED"].includes(job.state));
    $("#stat-videos").textContent = String(completed.length);
    $("#stat-shorts").textContent = String(completed.reduce((sum, job) => sum + (Number(job.completedClips) || 0), 0));
    $("#stat-active").textContent = String(active.length);
    $("#dashboard-projects").innerHTML = jobs.length
      ? jobs.slice(0, 4).map(jobCard).join("")
      : '<div class="empty-state">Your projects will appear here after you create a job.</div>';
    const downloads = jobs.flatMap((job) => (job.results || []).map((item) => downloadRow(job, item))).slice(0, 3);
    $("#dashboard-downloads").innerHTML = downloads.length
      ? downloads.join("")
      : '<div class="empty-state">Completed clip downloads will appear here.</div>';
    $$(".project-open").forEach((button) => button.addEventListener("click", () => openJob(button.dataset.openJob)));
  }

  function openJob(jobId) {
    const entry = jobs.find((item) => item.jobId === jobId);
    if (!entry) return;
    currentJob = entry;
    showPage("create");
    pollJob(entry);
  }

  async function validateYoutube() {
    const value = $("#youtube-url").value.trim();
    const hint = $("#youtube-validation");
    hint.textContent = "Checking URL…";
    hint.className = "field-hint";
    youtubeVideoId = null;
    $("#youtube-preview").innerHTML = "";
    $("#preview-wrap").classList.add("hidden");
    try {
      const result = await NexusAPI.validateYoutube(value);
      hint.textContent = result.message;
      hint.className = `field-hint ${result.valid ? "success-hint" : "error-hint"}`;
      if (result.valid) {
        youtubeVideoId = result.video_id;
        $("#preview-wrap").classList.remove("hidden");
        $("#source-preview").classList.add("hidden");
        $("#youtube-preview").innerHTML = `<iframe title="YouTube source preview" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(result.video_id)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
      }
    } catch (error) {
      hint.textContent = error.message;
      hint.className = "field-hint error-hint";
    }
    updateLaunchAvailability();
  }

  function selectFile(file) {
    selectedFile = file || null;
    youtubeVideoId = null;
    $("#selected-file").classList.toggle("hidden", !file);
    $("#preview-wrap").classList.toggle("hidden", !file);
    if (!file) return;
    $("#selected-file").innerHTML = `<span>▣</span><div><b>${escapeHtml(file.name)}</b><small>${(file.size / (1024 * 1024)).toFixed(1)} MB</small></div>`;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    $("#youtube-preview").innerHTML = "";
    $("#source-preview").classList.remove("hidden");
    $("#source-preview").src = objectUrl;
    $("#source-preview").load();
    updateLaunchAvailability();
  }

  function bindEvents() {
    document.addEventListener("click", refreshDownloadLink);
    $$("[data-page]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));
    $("#menu-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    $("#quick-check").addEventListener("click", () => refreshServerStatus(true));
    $("#check-server").addEventListener("click", () => refreshServerStatus(true));
    $("#retry-server").addEventListener("click", () => {
      if (server.mode === "free-testing") wakeServer();
      else refreshServerStatus(true);
    });
    $("#start-server").addEventListener("click", wakeServer);
    $("#validate-url").addEventListener("click", validateYoutube);
    $("#youtube-url").addEventListener("input", () => {
      youtubeVideoId = null;
      updateLaunchAvailability();
    });
    $$(".source-tab").forEach((tab) => tab.addEventListener("click", () => {
      sourceMode = tab.dataset.source;
      $$(".source-tab").forEach((item) => item.classList.toggle("active", item === tab));
      $("#youtube-source").classList.toggle("hidden", sourceMode !== "youtube");
      $("#upload-source").classList.toggle("hidden", sourceMode !== "upload");
      updateLaunchAvailability();
    }));
    $("#video-file").addEventListener("change", (event) => selectFile(event.target.files[0]));
    $("#clip-count").addEventListener("change", updateLaunchAvailability);
    $("#clip-count").addEventListener("change", () => $("#custom-count").classList.toggle("hidden", $("#clip-count").value !== "custom"));
    $("#custom-count").addEventListener("input", updateLaunchAvailability);
    $("#clip-duration").addEventListener("change", () => {
      $("#custom-range").classList.toggle("hidden", $("#clip-duration").value !== "range");
      $("#custom-duration").classList.toggle("hidden", $("#clip-duration").value !== "custom");
      updateLaunchAvailability();
    });
    $("#custom-duration").addEventListener("input", updateLaunchAvailability);
    $("#range-start").addEventListener("input", updateLaunchAvailability);
    $("#range-end").addEventListener("input", updateLaunchAvailability);
    $("#launch-job").addEventListener("click", launchJob);
    $("#cancel-job").addEventListener("click", cancelCurrentJob);
    $("#retry-job").addEventListener("click", retryCurrentJob);
    $("#clear-local-data").addEventListener("click", () => {
      if (!window.confirm("Remove saved job access tokens from this browser? This does not delete server-side jobs.")) return;
      jobs = [];
      saveJobs();
      renderSavedJobs();
      renderDashboard();
      notify("Saved browser project list cleared.", "success");
    });
  }

  async function initialize() {
    $("#api-base-value").textContent = NexusAPI.baseUrl || "Not configured";
    bindEvents();
    renderDashboard();
    renderSavedJobs();
    await refreshServerStatus();
    await populateJobDetails();
    jobs.forEach((job) => {
      if (job.state && !["COMPLETED", "FAILED", "CANCELLED"].includes(job.state)) pollJob(job);
    });
    window.setInterval(async () => {
      if (server.state === "WAKING UP") await refreshServerStatus(true);
    }, 4000);
  }

  initialize();
})();
