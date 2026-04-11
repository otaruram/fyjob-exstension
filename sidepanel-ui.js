window.SidepanelUI = (() => {
  const EMPTY_HISTORY_MARKUP = '<div style="text-align:center;color:var(--text-dim);font-size:11px;padding:12px;">No scans yet. Open a job page and hit Quick Match!</div>';
  const ERROR_HISTORY_MARKUP = '<div style="text-align:center;color:var(--text-dim);font-size:11px;padding:12px;">Failed to load history</div>';

  function setStatus(statusDot, statusText, type, text) {
    statusText.textContent = text;
    statusDot.className = "status-dot";
    if (type === "active") statusDot.classList.add("active");
    if (type === "error") statusDot.classList.add("error");
  }

  function clearJobCard(jobCard) {
    jobCard.classList.add("hidden");
  }

  function renderJobCard(elements, jobData) {
    elements.jobTitle.textContent = jobData.jobTitle || "Unknown Position";
    elements.jobCompany.textContent = jobData.company || "Unknown Company";
    elements.jobPortal.textContent = jobData.portal;
    elements.jobDescPreview.textContent = `${jobData.jobDescription.substring(0, 200)}...`;
    elements.jobCard.classList.remove("hidden");
  }

  function applyCreditPill(creditCount, pill, stats) {
    const isAdmin = stats.role === "admin";

    if (isAdmin) {
      creditCount.textContent = "∞";
      pill.style.borderColor = "rgba(139,92,246,0.4)";
      pill.style.color = "#a78bfa";
      pill.style.background = "rgba(139,92,246,0.1)";
      return;
    }

    creditCount.textContent = stats.credits_remaining ?? "—";
    pill.style.borderColor = "";
    pill.style.color = "";
    pill.style.background = "";

    if (stats.credits_remaining <= 0) {
      pill.style.borderColor = "rgba(248,113,113,0.3)";
      pill.style.color = "var(--danger)";
      pill.style.background = "var(--danger-dim)";
    }
  }

  function renderResults(elements, data, dashboardUrl, animateNumber) {
    elements.resultsSection.classList.remove("hidden");

    const score = data.matchScore || 0;
    const circumference = 314;
    const offset = circumference - (score / 100) * circumference;

    setTimeout(() => {
      elements.scoreRingFill.style.strokeDashoffset = offset;

      if (score >= 80) {
        elements.scoreRingFill.style.stroke = "var(--success)";
        elements.scoreLabel.textContent = "STRONG MATCH";
        elements.scoreLabel.style.color = "var(--success)";
      } else if (score >= 60) {
        elements.scoreRingFill.style.stroke = "var(--primary)";
        elements.scoreLabel.textContent = "COMPETITIVE";
        elements.scoreLabel.style.color = "var(--primary)";
      } else if (score >= 40) {
        elements.scoreRingFill.style.stroke = "var(--warning)";
        elements.scoreLabel.textContent = "NEEDS WORK";
        elements.scoreLabel.style.color = "var(--warning)";
      } else {
        elements.scoreRingFill.style.stroke = "var(--danger)";
        elements.scoreLabel.textContent = "HIGH RISK";
        elements.scoreLabel.style.color = "var(--danger)";
      }
    }, 100);

    animateNumber(elements.scoreNumber, 0, score, 1200);

    elements.skillGaps.innerHTML = "";
    const gaps = data.gaps || [];
    gaps.forEach((gap, index) => {
      const tag = document.createElement("span");
      tag.className = `tag ${index < 3 ? "tag-danger" : "tag-warning"}`;
      tag.textContent = gap;
      elements.skillGaps.appendChild(tag);
    });

    if (gaps.length === 0) {
      elements.skillGaps.innerHTML = '<span class="tag tag-warning">No critical gaps found — impressive.</span>';
    }

    const insightContent = Array.isArray(data.insights)
      ? data.insights.join("\n\n")
      : typeof data.insights === "string"
        ? data.insights
        : "Ujang is analyzing your profile...";

    elements.insightText.textContent = insightContent;
    elements.btnDashboard.href = `${dashboardUrl}/dashboard`;
  }

  function renderHistory(historyList, history) {
    historyList.innerHTML = "";

    if (!history || history.length === 0) {
      historyList.innerHTML = EMPTY_HISTORY_MARKUP;
      return;
    }

    history.forEach((item) => {
      const score = item.matchScore || 0;
      const scoreClass = score >= 75 ? "high" : score >= 50 ? "mid" : "low";

      const el = document.createElement("div");
      el.className = "history-item";
      el.innerHTML = `
        <div class="history-item-left">
          <div class="history-item-title">${item.jobTitle || "Unknown"}</div>
          <div class="history-item-meta">${item.portal || ""} • ${new Date(item.created_at).toLocaleDateString()}</div>
        </div>
        <div class="history-score ${scoreClass}">${score}%</div>
      `;
      historyList.appendChild(el);
    });
  }

  return {
    EMPTY_HISTORY_MARKUP,
    ERROR_HISTORY_MARKUP,
    setStatus,
    clearJobCard,
    renderJobCard,
    applyCreditPill,
    renderResults,
    renderHistory,
  };
})();