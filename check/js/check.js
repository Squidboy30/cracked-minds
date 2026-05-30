// Cracked Minds Check — client-side logic
// Handles: company search, free preview, Stripe checkout, paid report render

const API = "https://parsebit.fly.dev";
const STRIPE_KEY = ""; // Set your Stripe publishable key here

// ----------------------------------------------------------------
// State
// ----------------------------------------------------------------
let selectedCompany = null;
let stripe = null;

// ----------------------------------------------------------------
// DOM refs
// ----------------------------------------------------------------
const searchInput  = document.getElementById("search-input");
const searchBtn    = document.getElementById("search-btn");
const resultsList  = document.getElementById("results-list");
const loading      = document.getElementById("loading");
const errorMsg     = document.getElementById("error-msg");
const reportWrap   = document.getElementById("report-wrap");

// ----------------------------------------------------------------
// Init
// ----------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  searchBtn.addEventListener("click", handleSearch);
  searchInput.addEventListener("keydown", e => { if (e.key === "Enter") handleSearch(); });

  // Handle return from Stripe
  const params = new URLSearchParams(window.location.search);
  if (params.get("success") === "true" && params.get("session_id") && params.get("company")) {
    handleStripeReturn(params.get("session_id"), params.get("company"));
  }
});

// ----------------------------------------------------------------
// Search
// ----------------------------------------------------------------
async function handleSearch() {
  const q = searchInput.value.trim();
  if (!q) return;

  setLoading(true);
  hideError();
  resultsList.classList.remove("visible");
  reportWrap.classList.remove("visible");

  try {
    // Search Companies House directly (public endpoint, no auth needed)
    const res = await fetch(
      `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(q)}&items_per_page=5`
    );
    if (!res.ok) throw new Error("Search failed");
    const data = await res.json();
    renderResults(data.items || []);
  } catch (err) {
    // Fallback: send straight to API in stub mode
    renderResults([{
      company_number: "STUB",
      title: q.toUpperCase(),
      company_status: "active",
      company_type: "ltd",
      date_of_creation: null,
      address_snippet: "Stub mode — Companies House API key not configured"
    }]);
  } finally {
    setLoading(false);
  }
}

function renderResults(items) {
  resultsList.innerHTML = "";
  if (!items.length) {
    showError("No companies found. Try a different name.");
    return;
  }
  items.forEach(item => {
    const div = document.createElement("div");
    div.className = "result-item";
    const statusClass = item.company_status === "active" ? "status-active"
      : item.company_status === "dissolved" ? "status-dissolved" : "status-other";
    div.innerHTML = `
      <div>
        <div class="result-name">${item.title || item.company_name || ""}</div>
        <div class="result-meta">${item.company_number || ""} · ${item.address_snippet || ""}</div>
      </div>
      <span class="status-badge ${statusClass}">${item.company_status || "unknown"}</span>
    `;
    div.addEventListener("click", () => selectCompany(item));
    resultsList.appendChild(div);
  });
  resultsList.classList.add("visible");
}

// ----------------------------------------------------------------
// Free preview
// ----------------------------------------------------------------
async function selectCompany(item) {
  selectedCompany = item;
  resultsList.classList.remove("visible");
  setLoading(true);
  reportWrap.classList.remove("visible");

  try {
    const res = await fetch(`${API}/analyse/company`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_name: item.title || item.company_name,
        company_number: item.company_number !== "STUB" ? item.company_number : null,
        include_accounts: false
      })
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    renderFreePreview(data);
  } catch (err) {
    showError(`Could not load company data: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

function renderFreePreview(data) {
  const c = data.company;
  const risk = data.risk_assessment;
  const riskClass = risk.overall === "low" ? "low" : risk.overall === "high" ? "high" : "medium";

  document.getElementById("report-company-name").textContent = c.name;
  document.getElementById("report-number").textContent = `Company No. ${c.number}`;

  document.getElementById("risk-score-number").textContent = risk.score;
  document.getElementById("risk-score-number").className = `risk-score-number ${riskClass}`;
  document.getElementById("risk-score-label").textContent = `${risk.overall} risk`;

  // Company details
  document.getElementById("kv-status").innerHTML =
    `<span class="status-badge ${c.status === "active" ? "status-active" : "status-dissolved"}">${c.status}</span>`;
  document.getElementById("kv-type").textContent = c.type || "—";
  document.getElementById("kv-incorporated").textContent = c.incorporated || "—";
  document.getElementById("kv-address").textContent = c.address || "—";

  // Directors
  const tbody = document.getElementById("directors-body");
  tbody.innerHTML = "";
  (data.directors || []).forEach(d => {
    const tr = document.createElement("tr");
    const nameClass = d.resigned ? "resigned-name" : "";
    tr.innerHTML = `
      <td class="${nameClass}">${d.name}</td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:12px">${d.appointed || "—"}</td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text-secondary)">${d.resigned || "Current"}</td>
    `;
    tbody.appendChild(tr);
  });

  // Filings
  document.getElementById("kv-last-accounts").textContent = data.filings.latest_accounts_date || "—";
  document.getElementById("kv-overdue").innerHTML = data.filings.accounts_overdue
    ? '<span style="color:var(--red)">Yes</span>' : '<span style="color:var(--green)">No</span>';
  document.getElementById("kv-late-filings").textContent = data.filings.late_filings_count || "0";

  // Stub notice
  if (data._meta && data._meta.stub_mode) {
    document.getElementById("stub-notice").style.display = "block";
  }

  // Show unlock CTA
  document.getElementById("unlock-cta").style.display = "block";
  document.getElementById("report-recommendation").textContent =
    "Unlock the full report to see the complete AI risk assessment and recommendation.";

  // Flags/positives shown blurred until paid
  renderPills("flags-list", risk.flags || [], "pill-red");
  renderPills("positives-list", risk.positives || [], "pill-green");

  reportWrap.classList.add("visible");
  reportWrap.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPills(containerId, items, cls) {
  const el = document.getElementById(containerId);
  el.innerHTML = items.length
    ? items.map(i => `<span class="pill ${cls}">${i}</span>`).join("")
    : `<span style="color:var(--text-tertiary);font-size:13px">None identified</span>`;
}

// ----------------------------------------------------------------
// Stripe checkout
// ----------------------------------------------------------------
async function handleCheckout(reportType) {
  if (!selectedCompany) return;

  const priceId = reportType === "subscription"
    ? (window.STRIPE_PRICE_ID_PRO || "")
    : (window.STRIPE_PRICE_ID_REPORT || "");

  if (!priceId) {
    showError("Payment not yet configured. Please check back soon.");
    return;
  }

  try {
    const res = await fetch("/.netlify/functions/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        priceId,
        companyNumber: selectedCompany.company_number,
        companyName: selectedCompany.title || selectedCompany.company_name,
        reportType
      })
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      throw new Error(data.error || "Checkout failed");
    }
  } catch (err) {
    showError(`Payment error: ${err.message}`);
  }
}

// ----------------------------------------------------------------
// Handle return from Stripe
// ----------------------------------------------------------------
async function handleStripeReturn(sessionId, companyNumber) {
  setLoading(true);
  try {
    const res = await fetch(`/.netlify/functions/verify-payment?session_id=${sessionId}`);
    const data = await res.json();

    if (!data.paid) {
      showError("Payment not confirmed. Please try again.");
      return;
    }

    // Fetch full report
    const reportRes = await fetch(`${API}/analyse/company`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_number: companyNumber,
        include_accounts: true
      })
    });
    if (!reportRes.ok) throw new Error("Report fetch failed");
    const reportData = await reportRes.json();

    renderFreePreview(reportData);
    renderFullReport(reportData);
  } catch (err) {
    showError(`Could not load report: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

function renderFullReport(data) {
  const risk = data.risk_assessment;

  // Show recommendation
  document.getElementById("report-recommendation").textContent = risk.recommendation || "";

  // Hide unlock CTA
  document.getElementById("unlock-cta").style.display = "none";

  // Clean URL
  window.history.replaceState({}, "", window.location.pathname);
}

// ----------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------
function setLoading(on) {
  loading.classList.toggle("visible", on);
  searchBtn.disabled = on;
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.add("visible");
}

function hideError() {
  errorMsg.classList.remove("visible");
}
