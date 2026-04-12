window.SidepanelUI = (() => {
  const EMPTY_HISTORY_MARKUP = "<div class='muted'>No scans yet.</div>";
  const ERROR_HISTORY_MARKUP = "<div class='muted'>Failed to load history</div>";

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
    elements.jobPortal.textContent = jobData.portal || "Unknown";
    const preview = jobData.jobDescription || "";
    elements.jobDescPreview.textContent = preview.length > 220 ? `${preview.slice(0, 220)}...` : preview;
    elements.jobCard.classList.remove("hidden");
  }

  function applyCreditPill(creditCount, pill, stats) {
    const isAdmin = stats?.role === "admin";
    creditCount.textContent = isAdmin ? "∞" : String(stats?.credits_remaining ?? "-");
    if (isAdmin) {
      pill.style.borderColor = "#bbf7d0";
      pill.style.color = "#166534";
      return;
    }
    pill.style.borderColor = "";
    pill.style.color = "";
  }

  function renderResults(elements, data, dashboardUrl, animateNumber) {
    elements.resultsSection.classList.remove("hidden");
    const score = Number(data?.matchScore || 0);
    animateNumber(elements.scoreNumber, 0, score, 500);

    if (score >= 80) {
      elements.scoreLabel.textContent = "Strong Match";
    } else if (score >= 60) {
      elements.scoreLabel.textContent = "Competitive";
    } else if (score >= 40) {
      elements.scoreLabel.textContent = "Needs Work";
    } else {
      elements.scoreLabel.textContent = "High Risk";
    }

    elements.skillGaps.innerHTML = "";
    const gaps = Array.isArray(data?.gaps) ? data.gaps : [];
    if (!gaps.length) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "No critical gaps";
      elements.skillGaps.appendChild(tag);
    } else {
      for (const gap of gaps.slice(0, 8)) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = gap;
        elements.skillGaps.appendChild(tag);
      }
    }

    const insights = Array.isArray(data?.insights)
      ? data.insights.join("\n\n")
      : (data?.insights || "No insight yet.");
    elements.insightText.textContent = insights;
    elements.btnDashboard.href = `${dashboardUrl}/dashboard`;
  }

  function renderHistory(historyList, history) {
    historyList.innerHTML = "";
    if (!history || !history.length) {
      historyList.innerHTML = EMPTY_HISTORY_MARKUP;
      return;
    }

    for (const item of history) {
      const row = document.createElement("div");
      row.className = "history-item";
      const date = item?.created_at ? new Date(item.created_at).toLocaleDateString() : "-";
      row.innerHTML = `
        <div>
          <div class="history-item-title">${item.jobTitle || "Unknown"}</div>
          <div class="history-item-meta">${item.portal || "Unknown"} • ${date}</div>
        </div>
        <div class="history-score">${Number(item.matchScore || 0)}%</div>
      `;
      historyList.appendChild(row);
    }
  }

  function notify(type, message) {
    console.log(`[FYJOB:${type}]`, message);
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
    notify,
  };
})();
