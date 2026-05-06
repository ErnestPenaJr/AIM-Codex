const riskOrder = ["TOP", "HIGH", "MODERATE", "LOW"];
const riskColors = {
  TOP: "#d7263d",
  HIGH: "#f97316",
  MODERATE: "#f4c542",
  LOW: "#1d4ed8",
};

const DATA_SOURCE = "bsa_mock_data_500.csv";

let allRecords = [];
let dataLoaded = false;

let filters = {
  subjectName: "all",
  riskLevel: "all",
  transactionType: "all",
  residenceState: "all",
  activityState: "all",
  criminalHistory: "all",
};

let riskChart;
let refreshTimer;
const DEBOUNCE_MS = 200;
let subjectRankings = [];
let subjectRelationIndex = new Map();
let subjectLinkEnabled = new Set();
const tableState = {
  sortKey: "riskLevel",
  sortDir: "desc",
  search: "",
  startDate: "",
  endDate: "",
  pageSize: 15,
  page: 1,
  linkId: "",
};

$(document).ready(() => {
  initCharts();
  bindEvents();
  loadFilters().then(refreshAll);
});

function setRiskClearVisibility() {
  const riskValue = $("#risk-filter").val() || "all";
  $("#clear-risk-filter").toggleClass("is-hidden", riskValue === "all");
}

async function ensureDataLoaded() {
  if (dataLoaded) return;
  try {
    const csvText = await fetch(DATA_SOURCE, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${DATA_SOURCE}`);
      return r.text();
    });
    allRecords = parseBsaCsv(csvText);
    dataLoaded = true;
  } catch (error) {
    dataLoaded = false;
    Swal.fire({
      title: "Unable to load static data",
      text: error.message || String(error),
      icon: "error",
    });
    throw error;
  }
}

function bindEvents() {
  $("#subject-filter, #risk-filter, #transaction-filter, #residence-filter, #activity-filter, #criminal-filter").on(
    "change",
    () => {
    filters = collectFilters();
    debounceRefresh();
    setRiskClearVisibility();
  },
  );

  $("#table-search").on("input", (event) => {
    tableState.search = event.target.value || "";
    tableState.page = 1;
    renderSubjectRankings();
  });

  $("#table-page-size").on("change", (event) => {
    tableState.pageSize = Number(event.target.value) || 15;
    tableState.page = 1;
    renderSubjectRankings();
  });

  $("#table-link-filter").on("input", (event) => {
    tableState.linkId = event.target.value || "";
    tableState.page = 1;
    renderSubjectRankings();
  });

  $("#table-start-date").on("change", (event) => {
    tableState.startDate = event.target.value || "";
    tableState.page = 1;
    renderSubjectRankings();
  });

  $("#table-end-date").on("change", (event) => {
    tableState.endDate = event.target.value || "";
    tableState.page = 1;
    renderSubjectRankings();
  });

  $("#table-prev-page").on("click", () => {
    if (tableState.page > 1) {
      tableState.page -= 1;
      renderSubjectRankings();
    }
  });

  $("#table-next-page").on("click", () => {
    tableState.page += 1;
    renderSubjectRankings();
  });

  $("thead").on("click", ".sortable", (event) => {
    const key = $(event.currentTarget).data("sort");
    if (!key) return;
    if (tableState.sortKey === key) {
      tableState.sortDir = tableState.sortDir === "asc" ? "desc" : "asc";
    } else {
      tableState.sortKey = key;
      tableState.sortDir = "desc";
    }
    renderSubjectRankings();
  });

  $("#records-body").on("click", "tr", (event) => {
    const subjectName = $(event.currentTarget).data("subject");
    if (!subjectName) return;
    showSubjectDetails(subjectName);
  });

  $("#records-body").on("click", ".link-id-action", (event) => {
    event.stopPropagation();
    const linkId = $(event.currentTarget).data("linkid");
    const subjectName = $(event.currentTarget).data("subject");
    if (!linkId || !subjectName) return;
    showLinkIdDetails(subjectName, linkId);
  });

  $("#clear-filters").on("click", () => {
    filters = {
      subjectName: "all",
      riskLevel: "all",
      transactionType: "all",
      residenceState: "all",
      activityState: "all",
      criminalHistory: "all",
    };
    $("#subject-filter").val("all");
    $("#risk-filter").val("all");
    $("#transaction-filter").val("all");
    $("#residence-filter").val("all");
    $("#activity-filter").val("all");
    $("#criminal-filter").val("all");
    setRiskClearVisibility();
    debounceRefresh(true);
    Swal.fire({
      title: "Filters cleared",
      icon: "info",
      timer: 1200,
      showConfirmButton: false,
    });
  });

  $("#clear-risk-filter").on("click", () => {
    filters = { ...filters, riskLevel: "all" };
    $("#risk-filter").val("all");
    setRiskClearVisibility();
    debounceRefresh();
  });
}

function initCharts() {
  const riskCtx = document.getElementById("riskChart").getContext("2d");
  riskChart = new Chart(riskCtx, {
    type: "doughnut",
    data: {
      labels: riskOrder,
      datasets: [
        {
          data: [],
          backgroundColor: riskOrder.map((r) => riskColors[r]),
        },
      ],
    },
    options: {
      cutout: "60%",
      plugins: { legend: { display: false } },
      onClick: (_evt, elements) => {
        if (!elements.length) return;
        const idx = elements[0].index;
        const risk = riskChart.data.labels[idx];
        if (!risk) return;
        $("#risk-filter").val(risk);
        filters.riskLevel = risk;
        setRiskClearVisibility();
        drilldownAlert(`Filtered by ${risk} risk`);
        debounceRefresh();
      },
    },
  });
}

async function loadFilters() {
  await ensureDataLoaded();
  const data = buildFiltersFromRecords(applyAppFilters(allRecords, filters));

  const subjectSelect = $("#subject-filter");
  subjectSelect.empty().append('<option value="all">All Entities</option>');
  (data.subjects || []).forEach((subject) =>
    subjectSelect.append(`<option value="${subject}">${subject}</option>`),
  );

  const transactionSelect = $("#transaction-filter");
  transactionSelect.empty().append('<option value="all">All Types</option>');
  (data.transactionTypes || []).forEach((type) =>
    transactionSelect.append(`<option value="${type}">${type}</option>`),
  );

  const residenceSelect = $("#residence-filter");
  residenceSelect.empty().append('<option value="all">All States</option>');
  (data.residenceStates || []).forEach((state) =>
    residenceSelect.append(`<option value="${state}">${state}</option>`),
  );

  const activitySelect = $("#activity-filter");
  activitySelect.empty().append('<option value="all">All States</option>');
  (data.activityStates || []).forEach((state) =>
    activitySelect.append(`<option value="${state}">${state}</option>`),
  );

  const riskSelect = $("#risk-filter");
  riskSelect.empty().append('<option value="all">All</option>');
  (data.riskLevels || []).forEach((risk) =>
    riskSelect.append(`<option value="${risk}">${risk}</option>`),
  );

  const criminalSelect = $("#criminal-filter");
  criminalSelect.empty();
  [
    { value: "all", label: "All" },
    { value: "any", label: "Yes (any)" },
    { value: "none", label: "No" },
    { value: "violent", label: "Violent" },
    { value: "financial", label: "Financial" },
    { value: "felony", label: "Felony" },
  ].forEach((option) => {
    criminalSelect.append(`<option value="${option.value}">${option.label}</option>`);
  });
}

function collectFilters() {
  return {
    subjectName: $("#subject-filter").val() || "all",
    riskLevel: $("#risk-filter").val() || "all",
    transactionType: $("#transaction-filter").val() || "all",
    residenceState: $("#residence-filter").val() || "all",
    activityState: $("#activity-filter").val() || "all",
    criminalHistory: $("#criminal-filter").val() || "all",
  };
}

async function refreshAll() {
  filters = collectFilters();
  await Promise.all([
    loadSummary(),
    loadSubjectRankings(),
    loadRiskAmounts(),
  ]);
}

function debounceRefresh(immediate = false) {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (immediate) {
    refreshAll();
    return;
  }
  refreshTimer = setTimeout(() => refreshAll(), DEBOUNCE_MS);
}

async function loadSummary() {
  await ensureDataLoaded();
  const data = buildSummaryFromRecords(applyAppFilters(allRecords, filters));
  $("#total-subjects").text(formatNumber(data.uniqueSubjects));
  $("#total-transactions").text(formatNumber(data.totalTransactions));
  $("#total-amount").text(formatCurrency(data.totalAmount));
  $("#avg-amount").text(formatCurrency(data.averageAmount));
}

async function loadSubjectRankings() {
  await ensureDataLoaded();
  const filteredRecords = applyAppFilters(allRecords, filters);
  const relations = buildSubjectRelations(filteredRecords);
  subjectRelationIndex = relations.bySubject;
  const ranked = buildSubjectRankingsFromRecords(filteredRecords);
  subjectLinkEnabled = selectLinkedSubjects(ranked, subjectRelationIndex, 0.25);
  subjectRankings = ranked.map((row) => {
    const isRelated = subjectLinkEnabled.has(row.subjectName);
    return {
      ...row,
      related: isRelated,
      linkId: isRelated ? row.linkId : "",
    };
  });
  renderSubjectRankings();
}

function renderSubjectRankings() {
  const tbody = $("#records-body");
  tbody.empty();

  const filtered = applyTableFilters(subjectRankings);
  const sorted = applyTableSort(filtered);
  const totalPages = Math.max(1, Math.ceil(sorted.length / tableState.pageSize));
  const safePage = Math.min(Math.max(1, tableState.page), totalPages);
  tableState.page = safePage;
  const startIndex = (safePage - 1) * tableState.pageSize;
  const paged = sorted.slice(startIndex, startIndex + tableState.pageSize);

  paged.forEach((row, idx) => {
    const safeSubject = escapeHtml(row.subjectName);
    const safeLinkId = escapeHtml(row.linkId);
    const safeActivity = escapeHtml(row.activityLocation || "—");
    const safeRisk = escapeHtml(row.riskLevel || "LOW");
    const riskClass = `risk-cell risk-cell--${(row.riskLevel || "LOW").toLowerCase()}`;
    const linkIdContent = row.related && safeLinkId
      ? `<button type="button" class="link-id-action text-primary fw-semibold" data-linkid="${safeLinkId}" data-subject="${safeSubject}">${safeLinkId}</button>`
      : `${safeLinkId}`;
    tbody.append(`
      <tr data-subject="${safeSubject}">
        <td class="${riskClass}">${safeRisk}</td>
        <td>${linkIdContent}</td>
        <td class="fw-semibold">${safeSubject}</td>
        <td>${formatNumber(row.transactionCount)}</td>
        <td>${formatCurrency(row.totalAmount)}</td>
        <td>${safeActivity}</td>
        <td>${formatDate(row.firstTransactionDate)}</td>
        <td>${formatDate(row.lastTransactionDate)}</td>
      </tr>
    `);
  });

  $("#table-caption").text(
    `Showing ${paged.length} of ${sorted.length} filtered entities`,
  );
  $("#table-page-indicator").text(`${safePage} of ${totalPages}`);
  $("#table-prev-page").prop("disabled", safePage <= 1);
  $("#table-next-page").prop("disabled", safePage >= totalPages);
  renderPageButtons(safePage, totalPages);
  updateSortIndicators();
}

function renderPageButtons(currentPage, totalPages) {
  const container = $("#table-page-buttons");
  container.empty();

  if (totalPages <= 1) return;

  const pages = new Set([1, totalPages, currentPage]);
  for (let i = currentPage - 2; i <= currentPage + 2; i += 1) {
    if (i > 1 && i < totalPages) pages.add(i);
  }

  const pageList = Array.from(pages).sort((a, b) => a - b);
  let last = 0;
  pageList.forEach((page) => {
    if (page - last > 1) {
      container.append('<span class="px-2 text-muted">…</span>');
    }
    const isActive = page === currentPage;
    const btnClass = isActive ? "btn btn-primary" : "btn btn-outline-secondary";
    const button = $(`<button type="button" class="${btnClass}">${page}</button>`);
    button.on("click", () => {
      tableState.page = page;
      renderSubjectRankings();
    });
    container.append(button);
    last = page;
  });
}

async function loadRiskAmounts() {
  await ensureDataLoaded();
  const data = buildRiskAmountsFromRecords(applyAppFilters(allRecords, filters));
  const totals = riskOrder.map((risk) => data[risk] || 0);
  riskChart.data.datasets[0].data = totals;
  riskChart.update();
}

function setupDetailTooltips(container) {
  if (!container) return;
  const tooltips = container.querySelectorAll(".detail-tooltip");
  if (!tooltips.length) return;

  const alignTooltip = (tooltip) => {
    tooltip.classList.remove("detail-tooltip--align-right");
    const rect = tooltip.getBoundingClientRect();
    const modalRect = container.getBoundingClientRect();
    const estimatedWidth = 340;
    if (rect.left + estimatedWidth > modalRect.right - 16) {
      tooltip.classList.add("detail-tooltip--align-right");
    }
  };

  tooltips.forEach((tooltip) => {
    tooltip.addEventListener("mouseenter", () => alignTooltip(tooltip));
    tooltip.addEventListener("focus", () => alignTooltip(tooltip));
  });
}

function wireModalActionButtons() {
  const popup = document.querySelector(".enterprise-modal");
  if (!popup) return;
  const buttons = popup.querySelectorAll(".enterprise-modal__action-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const action = btn.dataset.action;
      const label = action === "create-request" ? "Create Request" : "Create Notification";
      showComingSoonToast(`${label} — coming soon`);
    });
  });
}

function showComingSoonToast(message) {
  let toast = document.querySelector(".coming-soon-toast");
  if (toast) {
    toast.remove();
  }
  toast = document.createElement("div");
  toast.className = "coming-soon-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("coming-soon-toast--visible"));
  window.setTimeout(() => {
    toast.classList.remove("coming-soon-toast--visible");
    window.setTimeout(() => toast.remove(), 250);
  }, 2200);
}

async function showSubjectDetails(subjectName) {
  await ensureDataLoaded();
  const data = buildSubjectDetailsFromRecords(allRecords, { ...filters, subjectName });

  const latest = data.transactions[0] || {};
  const profile = buildDemoProfile(subjectName, latest);
  const safeSubjectName = escapeHtml(data.subjectName);
  const safeLocation = escapeHtml(profile.location);
  const safeAddress = escapeHtml(profile.address);
  const safeCity = escapeHtml(profile.city);
  const safeState = escapeHtml(profile.state);
  const safeIp = escapeHtml(profile.ipAddress);
  const safeDevice = escapeHtml(profile.deviceId);
  const safeInstitutionState = escapeHtml(latest.institutionState || "—");
  const safeRiskLevel = escapeHtml(latest.riskLevel || "—");
  const safeBsaId = escapeHtml(normalizeBsaId(latest.bsaId));
  const safeFormType = escapeHtml(latest.formType || "—");
  const safePhone = escapeHtml(profile.phone);
  const safeEmail = escapeHtml(profile.email);
  const safeAccount = escapeHtml(profile.accountMasked);
  const safeAccountType = escapeHtml(profile.accountType);
  const safeOnboarding = escapeHtml(profile.onboardingChannel);
  const safeDeviceFp = escapeHtml(profile.deviceFingerprint);
  const safeLastLogin = escapeHtml(profile.lastLogin);
  const safeKyc = escapeHtml(profile.kycStatus);
  const safeWatchlist = escapeHtml(profile.watchlistFlag);
  const safeRiskScore = escapeHtml(profile.riskScore);
  const safeGeo = escapeHtml(profile.geo);
  const safeTimezone = escapeHtml(profile.timezone);
  const safeAlias = escapeHtml(profile.knownAlias);
  const safeCriminalHistory = escapeHtml(profile.criminalHistory);
  const safeAddressCheck = escapeHtml(profile.addressCheck);
  const safePublicRecordsFlag = escapeHtml(profile.publicRecordsFlag);
  const safeVpnTor = escapeHtml(profile.vpnTor);

  const riskPriority = { TOP: 3, HIGH: 2, MODERATE: 1, LOW: 0 };
  const transactions = data.transactions
    .map((tx) => {
      const dateValue = tx.transactionDate ? new Date(tx.transactionDate).getTime() : "";
      const bsaValue = String(normalizeBsaId(tx.bsaId)).replace(/\D/g, "");
      const amountValue = Number(tx.amountTotal) || 0;
      const riskValue = riskPriority[tx.riskLevel] ?? -1;
      const activityValue = String(tx.suspiciousActivityType || "").toLowerCase();
      const typeValue = String(tx.transactionType || "").toLowerCase();

      return `
      <tr>
        <td data-value="${dateValue}">${formatDate(tx.transactionDate)}</td>
        <td data-value="${bsaValue}">${normalizeBsaId(tx.bsaId)}</td>
        <td data-value="${amountValue}">${formatCurrency(tx.amountTotal)}</td>
        <td data-value="${riskValue}">${tx.riskLevel || "—"}</td>
        <td class="wrap-col" data-value="${activityValue}">${tx.suspiciousActivityType || "—"}</td>
        <td class="wrap-col" data-value="${typeValue}">${tx.transactionType || "—"}</td>
      </tr>
    `;
    })
    .join("");

  const physicalAddress = [latest.subjectState, latest.zip3]
    .filter(Boolean)
    .join(" ");

  Swal.fire({
    customClass: {
      popup: "enterprise-modal",
      title: "enterprise-modal__title",
    },
    title: safeSubjectName,
    width: "70rem",
    html: `
      <div class="enterprise-modal__actions">
        <button type="button" class="enterprise-modal__action-btn enterprise-modal__action-btn--request" data-action="create-request">Create Request</button>
        <button type="button" class="enterprise-modal__action-btn enterprise-modal__action-btn--notification" data-action="create-notification">Create Notification</button>
      </div>
      <div class="text-start">
        <div class="detail-grid">
          <div class="detail-card detail-card--api">
            <div class="detail-label">PACER/WebCrims Status Updates (API)</div>
            <div class="detail-value">Active</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Transactions</div>
            <div class="detail-value">${formatNumber(data.transactionCount)}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Total Amount</div>
            <div class="detail-value">${formatCurrency(data.totalAmount)}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Cash In / Out</div>
            <div class="detail-value">${formatCurrency(data.totalCashIn)} / ${formatCurrency(
              data.totalCashOut,
            )}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Timeframe</div>
            <div class="detail-value">${formatDate(data.firstTransactionDate)} - ${formatDate(
              data.lastTransactionDate,
            )}</div>
          </div>
          <div class="detail-card detail-card--risk">
            <div class="detail-label">Risk Level</div>
            <div class="detail-value">${safeRiskLevel}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Location</div>
            <div class="detail-value">${safeLocation}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Address</div>
            <div class="detail-value">${safeAddress}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">City</div>
            <div class="detail-value">${safeCity}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">State</div>
            <div class="detail-value">${safeState}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">IP Address</div>
            <div class="detail-value">${safeIp}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Device ID</div>
            <div class="detail-value">${safeDevice}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Device Fingerprint</div>
            <div class="detail-value">${safeDeviceFp}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Last Login</div>
            <div class="detail-value">${safeLastLogin}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Phone</div>
            <div class="detail-value">${safePhone}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Email</div>
            <div class="detail-value">${safeEmail}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Account</div>
            <div class="detail-value">${safeAccount}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Account Type</div>
            <div class="detail-value">${safeAccountType}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Onboarding</div>
            <div class="detail-value">${safeOnboarding}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">KYC Status</div>
            <div class="detail-value">${safeKyc}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Watchlist</div>
            <div class="detail-value">${safeWatchlist}</div>
          </div>
          <div class="detail-card detail-card--risk">
            <div class="detail-label">Risk Score</div>
            <div class="detail-value">${safeRiskScore}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Geo Coordinates</div>
            <div class="detail-value">${safeGeo}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Timezone</div>
            <div class="detail-value">${safeTimezone}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Known Alias</div>
            <div class="detail-value">${safeAlias}</div>
          </div>
          <div class="detail-card detail-card--flagged">
            <div class="detail-label">
              <span
                class="detail-tooltip"
                tabindex="0"
                data-tooltip="P - A discrepancy was identified between customer information (address, phone,...) and public records&#10;N - No discrepancy was identified between customer information (address, phone,...) and public records"
              >
                Public Records Flag
                <span class="detail-tooltip__icon" aria-hidden="true">i</span>
              </span>
            </div>
            <div class="detail-value">${safePublicRecordsFlag}</div>
          </div>
          <div class="detail-card detail-card--flagged">
            <div class="detail-label">
              <span
                class="detail-tooltip"
                tabindex="0"
                data-tooltip="VPN - IP address is associated to a company that offers VPN services&#10;TOR - IP address is associated to a TOR exit node&#10;Hosting - IP address is associated to a company that offers hosting services"
              >
                VPN/TOR
                <span class="detail-tooltip__icon" aria-hidden="true">i</span>
              </span>
            </div>
            <div class="detail-value">${safeVpnTor}</div>
          </div>
          <div class="detail-card detail-card--flagged">
            <div class="detail-label">
              <span
                class="detail-tooltip"
                tabindex="0"
                data-tooltip="N - No criminal history match&#10;Y - Criminal history match&#10;Violent - Criminal history match including a violent crime offense&#10;Financial - Criminal history match including a financial crime offense&#10;Felony - Criminal history match including a felony criminal offense"
              >
                Criminal History
                <span class="detail-tooltip__icon" aria-hidden="true">i</span>
              </span>
            </div>
            <div class="detail-value">${safeCriminalHistory}</div>
          </div>
          <div class="detail-card detail-card--flagged">
            <div class="detail-label">
              <span
                class="detail-tooltip"
                tabindex="0"
                data-tooltip="Fictitious - Address is not valid as per USPS&#10;Valid Address - Address is valid as per USPS&#10;Private Mailbox - Address is valid as per USPS and associated to a company that sells private mailbox services (UPS Store, Mailboxes etc)&#10;Business Address - Address is valid as per USPS and associated to a business address (non-residential)"
              >
                Address Check
                <span class="detail-tooltip__icon" aria-hidden="true">i</span>
              </span>
            </div>
            <div class="detail-value">${safeAddressCheck}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Institution State</div>
            <div class="detail-value">${safeInstitutionState}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">BSA ID</div>
            <div class="detail-value">${safeBsaId}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Form Type</div>
            <div class="detail-value">${safeFormType}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Physical Address (State/ZIP3)</div>
            <div class="detail-value">${physicalAddress || "—"}</div>
          </div>
        </div>
        <div class="table-responsive detail-table">
          <table class="table table-sm table-striped align-middle">
            <thead>
              <tr>
                <th class="sortable" data-type="date">Date</th>
                <th class="sortable" data-type="number">BSA ID</th>
                <th class="sortable" data-type="number">Amount</th>
                <th class="sortable" data-type="number">Risk</th>
                <th class="sortable wrap-col" data-type="string">Activity</th>
                <th class="sortable wrap-col" data-type="string">Transaction Type</th>
              </tr>
            </thead>
            <tbody>
              ${transactions || "<tr><td colspan=\"6\">No transactions found</td></tr>"}
            </tbody>
          </table>
        </div>
      </div>
    `,
    showConfirmButton: true,
    didOpen: () => {
      setupDetailTooltips(document.querySelector(".enterprise-modal"));
      wireModalActionButtons({ subjectName: data.subjectName });
      const table = document.querySelector(".enterprise-modal .detail-table table");
      if (!table) return;
      const headers = table.querySelectorAll("thead th.sortable");
      headers.forEach((header) => {
        header.addEventListener("click", () => {
          const headerRow = header.parentElement;
          const index = Array.from(headerRow.children).indexOf(header);
          const tbody = table.querySelector("tbody");
          if (!tbody) return;

          const rows = Array.from(tbody.querySelectorAll("tr")).filter(
            (row) => row.children.length > 1,
          );
          if (!rows.length) return;

          const currentKey = table.dataset.sortKey;
          const currentDir = table.dataset.sortDir || "asc";
          const nextDir = currentKey === String(index) && currentDir === "asc" ? "desc" : "asc";
          const type = header.dataset.type || "string";

          rows.sort((rowA, rowB) => {
            const cellA = rowA.children[index];
            const cellB = rowB.children[index];
            const valueA = cellA?.dataset.value ?? cellA?.textContent ?? "";
            const valueB = cellB?.dataset.value ?? cellB?.textContent ?? "";

            if (type === "number" || type === "date") {
              return (Number(valueA) || 0) - (Number(valueB) || 0);
            }
            return String(valueA).localeCompare(String(valueB));
          });

          if (nextDir === "desc") rows.reverse();
          rows.forEach((row) => tbody.appendChild(row));
          table.dataset.sortKey = String(index);
          table.dataset.sortDir = nextDir;
        });
      });
    },
  });
}

async function showLinkIdDetails(subjectName, linkId) {
  await ensureDataLoaded();
  const relatedSubjects = subjectRelationIndex.get(subjectName) || new Set();
  const subjectGroup = new Set(
    [subjectName, ...relatedSubjects].filter((name) => subjectLinkEnabled.has(name)),
  );
  const data = buildLinkIdDetailsFromRecords(allRecords, {
    ...filters,
    linkId,
    relatedSubjects: Array.from(subjectGroup),
  });

  const safeLinkId = escapeHtml(data.linkId);
  const safeEntityCount = escapeHtml(formatNumber(data.entityCount));
  const safeDescription = escapeHtml(data.description);
  const entityRows = data.entities
    .map((entity) => {
      const subjectValue = String(entity.subjectName || "").toLowerCase();
      const locationValue = String(entity.activityLocation || "").toLowerCase();
      const rangeMin = entity.minTransactionDate ? new Date(entity.minTransactionDate).getTime() : 0;
      const rangeMax = entity.maxTransactionDate ? new Date(entity.maxTransactionDate).getTime() : 0;
      const rangeValue = rangeMin || rangeMax || "";

      return `
      <tr>
        <td data-value="${subjectValue}">${escapeHtml(entity.subjectName || "—")}</td>
        <td data-value="${entity.transactionCount}">${formatNumber(entity.transactionCount)}</td>
        <td data-value="${entity.totalAmount}">${formatCurrency(entity.totalAmount)}</td>
        <td class="wrap-col" data-value="${locationValue}">${escapeHtml(entity.activityLocation || "—")}</td>
        <td data-value="${rangeValue}">${formatDate(entity.minTransactionDate)} - ${formatDate(
        entity.maxTransactionDate,
      )}</td>
      </tr>
    `;
    })
    .join("");

  Swal.fire({
    customClass: {
      popup: "enterprise-modal",
      title: "enterprise-modal__title",
    },
    title: `Link ID ${safeLinkId}`,
    width: "70rem",
    html: `
      <div class="enterprise-modal__actions">
        <button type="button" class="enterprise-modal__action-btn enterprise-modal__action-btn--request" data-action="create-request">Create Request</button>
        <button type="button" class="enterprise-modal__action-btn enterprise-modal__action-btn--notification" data-action="create-notification">Create Notification</button>
      </div>
      <div class="text-start">
        <div class="detail-grid">
          <div class="detail-card detail-card--api">
            <div class="detail-label">PACER/WebCrims Status Updates (API)</div>
            <div class="detail-value">Active</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Entities</div>
            <div class="detail-value">${safeEntityCount}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Transactions</div>
            <div class="detail-value">${formatNumber(data.transactionCount)}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Total Amount</div>
            <div class="detail-value">${formatCurrency(data.totalAmount)}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Cash In / Out</div>
            <div class="detail-value">${formatCurrency(data.totalCashIn)} / ${formatCurrency(
              data.totalCashOut,
            )}</div>
          </div>
          <div class="detail-card">
            <div class="detail-label">Timeframe</div>
            <div class="detail-value">${formatDate(data.firstTransactionDate)} - ${formatDate(
              data.lastTransactionDate,
            )}</div>
          </div>
          <div class="detail-card detail-card--full">
            <div class="detail-label">Description</div>
            <div class="detail-value">${safeDescription}</div>
          </div>
        </div>
        <div class="table-responsive detail-table">
          <table class="table table-sm table-striped align-middle">
            <thead>
              <tr>
                <th class="sortable" data-type="string">Entity</th>
                <th class="sortable" data-type="number">Transactions</th>
                <th class="sortable" data-type="number">Total Amount</th>
                <th class="sortable wrap-col" data-type="string">Activity Location</th>
                <th class="sortable" data-type="date">Activity Range</th>
              </tr>
            </thead>
            <tbody>
              ${entityRows || "<tr><td colspan=\"5\">No entities found</td></tr>"}
            </tbody>
          </table>
        </div>
      </div>
    `,
    showConfirmButton: true,
    didOpen: () => {
      wireModalActionButtons({ linkId: data.linkId });
      const table = document.querySelector(".enterprise-modal .detail-table table");
      if (!table) return;
      const headers = table.querySelectorAll("thead th.sortable");
      headers.forEach((header) => {
        header.addEventListener("click", () => {
          const headerRow = header.parentElement;
          const index = Array.from(headerRow.children).indexOf(header);
          const tbody = table.querySelector("tbody");
          if (!tbody) return;

          const rows = Array.from(tbody.querySelectorAll("tr")).filter(
            (row) => row.children.length > 1,
          );
          if (!rows.length) return;

          const currentKey = table.dataset.sortKey;
          const currentDir = table.dataset.sortDir || "asc";
          const nextDir = currentKey === String(index) && currentDir === "asc" ? "desc" : "asc";
          const type = header.dataset.type || "string";

          rows.sort((rowA, rowB) => {
            const cellA = rowA.children[index];
            const cellB = rowB.children[index];
            const valueA = cellA?.dataset.value ?? cellA?.textContent ?? "";
            const valueB = cellB?.dataset.value ?? cellB?.textContent ?? "";

            if (type === "number" || type === "date") {
              return (Number(valueA) || 0) - (Number(valueB) || 0);
            }
            return String(valueA).localeCompare(String(valueB));
          });

          if (nextDir === "desc") rows.reverse();
          rows.forEach((row) => tbody.appendChild(row));
          table.dataset.sortKey = String(index);
          table.dataset.sortDir = nextDir;
        });
      });
    },
  });
}

function buildDemoProfile(subjectName, latest) {
  const seedInput = `${subjectName || "subject"}-${latest.bsaId || ""}-${latest.zip3 || ""}`;
  const seed = hashString(seedInput);
  const streetNames = [
    "Oak",
    "Pine",
    "Maple",
    "Cedar",
    "Elm",
    "Lakeview",
    "Hillcrest",
    "Riverside",
    "Park",
    "Washington",
    "Jefferson",
    "Adams",
    "Jackson",
    "Madison",
  ];
  const streetTypes = ["St", "Ave", "Blvd", "Dr", "Ln", "Rd", "Way", "Pl"];
  const unitPrefixes = ["Apt", "Unit", "Suite"];
  const citiesByState = {
    CA: ["Los Angeles", "San Diego", "San Jose", "Sacramento", "Oakland"],
    NY: ["New York", "Buffalo", "Rochester", "Albany", "Syracuse"],
    TX: ["Houston", "Dallas", "Austin", "San Antonio", "Fort Worth"],
    FL: ["Miami", "Orlando", "Tampa", "Jacksonville", "St. Petersburg"],
    IL: ["Chicago", "Naperville", "Evanston", "Aurora", "Peoria"],
    GA: ["Atlanta", "Savannah", "Augusta", "Macon", "Athens"],
    WA: ["Seattle", "Tacoma", "Bellevue", "Spokane", "Everett"],
    AZ: ["Phoenix", "Tucson", "Mesa", "Scottsdale", "Tempe"],
    CO: ["Denver", "Boulder", "Aurora", "Fort Collins", "Colorado Springs"],
    NC: ["Charlotte", "Raleigh", "Durham", "Greensboro", "Wilmington"],
    NJ: ["Newark", "Jersey City", "Hoboken", "Paterson", "Trenton"],
    MA: ["Boston", "Cambridge", "Springfield", "Lowell", "Worcester"],
    VA: ["Arlington", "Alexandria", "Richmond", "Norfolk", "Chesapeake"],
  };
  const fallbackCities = [
    { city: "Washington", state: "DC" },
    { city: "Nashville", state: "TN" },
    { city: "Las Vegas", state: "NV" },
    { city: "Portland", state: "OR" },
  ];
  const ipBlocks = ["203.0.113", "198.51.100", "192.0.2"];
  const areaCodes = [212, 213, 214, 305, 312, 404, 415, 512, 617, 702, 713, 917];
  const accountTypes = ["Checking", "Savings", "Business", "Trust"];
  const onboardingChannels = ["Online", "Branch", "Partner", "Mobile"];
  const kycStatuses = ["Verified", "Pending Review", "Enhanced Due Diligence"];
  const watchlistFlags = ["None", "Potential Match", "Confirmed Match"];
  const timezonesByState = {
    CA: "America/Los_Angeles",
    WA: "America/Los_Angeles",
    OR: "America/Los_Angeles",
    NV: "America/Los_Angeles",
    AZ: "America/Phoenix",
    CO: "America/Denver",
    TX: "America/Chicago",
    IL: "America/Chicago",
    GA: "America/New_York",
    FL: "America/New_York",
    NY: "America/New_York",
    MA: "America/New_York",
    NJ: "America/New_York",
    VA: "America/New_York",
    NC: "America/New_York",
    DC: "America/New_York",
    TN: "America/Chicago",
  };
  const aliasFirstNames = ["Alex", "Jordan", "Taylor", "Morgan", "Riley", "Casey", "Cameron"];
  const aliasLastNames = ["Johnson", "Lee", "Martinez", "Patel", "Nguyen", "Walker", "Reed"];

  const state = latest.subjectState || latest.institutionState || fallbackCities[seed % fallbackCities.length].state;
  const cityOptions = citiesByState[state];
  const city = cityOptions ? cityOptions[seed % cityOptions.length] : fallbackCities[seed % fallbackCities.length].city;
  const street = streetNames[seed % streetNames.length];
  const streetType = streetTypes[seed % streetTypes.length];
  const number = 120 + (seed % 8800);
  const unitPrefix = unitPrefixes[seed % unitPrefixes.length];
  const unit = 100 + (seed % 600);
  const zip3 = latest.zip3 || String(100 + (seed % 900));
  const ipBlock = ipBlocks[seed % ipBlocks.length];
  const ipAddress = `${ipBlock}.${(seed % 200) + 10}`;
  const deviceId = `DEV-${seed.toString(16).padStart(12, "0").slice(0, 12).toUpperCase()}`;
  const deviceFingerprint = `FP-${((seed >> 3) ^ 0x45a3b).toString(16).padStart(10, "0").toUpperCase()}`;
  const areaCode = areaCodes[seed % areaCodes.length];
  const phone = `(${areaCode}) ${((seed >> 4) % 900) + 100}-${(seed % 9000 + 1000).toString().slice(0, 4)}`;
  const domain = ["examplebank.com", "mailtrust.co", "securemail.net"][seed % 3];
  const emailSlug = (subjectName || "client")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 10);
  const email = `${emailSlug || "client"}${seed % 90}@${domain}`;
  const accountMasked = `****${(seed % 10000).toString().padStart(4, "0")}`;
  const accountType = accountTypes[seed % accountTypes.length];
  const onboardingChannel = onboardingChannels[seed % onboardingChannels.length];
  const kycStatus = kycStatuses[seed % kycStatuses.length];
  const watchlistFlag = watchlistFlags[seed % watchlistFlags.length];
  const riskScore = `${(seed % 61) + 40}/100`;
  const geo = `${(32 + (seed % 15) + (seed % 100) / 100).toFixed(2)}, ${(-124 + (seed % 30) + (seed % 100) / 100).toFixed(2)}`;
  const timezone = timezonesByState[state] || "America/New_York";
  const knownAlias = `${aliasFirstNames[seed % aliasFirstNames.length]} ${aliasLastNames[seed % aliasLastNames.length]}`;
  const criminalHistory = deriveCriminalHistory(subjectName, latest.zip3);
  const addressCheck = buildAddressCheck(seed);
  const publicRecordsFlag = buildPublicRecordsFlag(seed);
  const vpnTor = buildVpnTor(seed);
  const lastLoginDate = new Date(Date.now() - ((seed % 20) + 1) * 86400000);
  const lastLogin = `${lastLoginDate.toLocaleDateString()} ${lastLoginDate.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;

  return {
    location: `${city}, ${state} ${zip3}xx`,
    address: `${number} ${street} ${streetType}, ${unitPrefix} ${unit}`,
    city,
    state,
    ipAddress,
    deviceId,
    deviceFingerprint,
    phone,
    email,
    accountMasked,
    accountType,
    onboardingChannel,
    kycStatus,
    watchlistFlag,
    riskScore,
    geo,
    timezone,
    knownAlias,
    criminalHistory,
    addressCheck,
    publicRecordsFlag,
    vpnTor,
    lastLogin,
  };
}

function deriveCriminalHistory(subjectName, zip3) {
  const seed = hashString(`${subjectName || "subject"}-${zip3 || ""}-criminal`);
  return buildCriminalHistory(seed);
}

function buildCriminalHistory(seed) {
  const roll = seed % 100;
  if (roll < 60) return "N";
  if (roll < 70) return "Y";

  const tags = ["Violent", "Financial", "Felony"];
  const tagSeed = Math.max(1, (seed % 7));
  const selected = tags.filter((_tag, idx) => (tagSeed >> idx) & 1);
  return selected.length ? selected.join(", ") : "N";
}

function buildAddressCheck(seed) {
  const roll = seed % 100;
  if (roll < 70) return "Valid Address";
  if (roll < 80) return "Private Mailbox";
  if (roll < 90) return "Business Address";
  return "Fictitious";
}

function buildPublicRecordsFlag(seed) {
  return seed % 100 < 65 ? "N" : "P";
}

function buildVpnTor(seed) {
  const options = ["VPN", "TOR", "Hosting"];
  return options[seed % options.length];
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function formatNumber(value) {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString();
}

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
}

function drilldownAlert(title) {
  Swal.fire({
    customClass: {
      popup: "enterprise-toast",
      title: "enterprise-toast__title",
    },
    title,
    text: "Charts and table updated. Click again to refine further.",
    icon: "info",
    timer: 1400,
    showConfirmButton: false,
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeBsaId(value) {
  if (value === null || value === undefined || value === "") return "—";
  const raw = String(value).trim();
  if (!/[eE]/.test(raw)) return raw;
  const match = raw.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!match) return raw;

  const sign = match[1];
  const intPart = match[2];
  const fracPart = match[3] || "";
  const exp = Number.parseInt(match[4], 10);
  const digits = intPart + fracPart;

  if (exp >= 0) {
    if (exp >= fracPart.length) {
      return `${sign}${digits}${"0".repeat(exp - fracPart.length)}`;
    }
    const index = intPart.length + exp;
    return `${sign}${digits.slice(0, index)}.${digits.slice(index)}`;
  }

  const shift = Math.abs(exp);
  if (shift >= intPart.length) {
    return `${sign}0.${"0".repeat(shift - intPart.length)}${digits}`;
  }
  const index = intPart.length - shift;
  return `${sign}${digits.slice(0, index)}.${digits.slice(index)}`;
}

function applyTableFilters(records) {
  const searchValue = tableState.search.trim().toLowerCase();
  const linkValue = tableState.linkId.trim().toLowerCase();
  const startDate = tableState.startDate ? new Date(tableState.startDate) : null;
  const endDate = tableState.endDate ? new Date(tableState.endDate) : null;
  const hasDateFilter = startDate || endDate;

  return records.filter((row) => {
    if (linkValue) {
      if (!String(row.linkId || "").toLowerCase().includes(linkValue)) {
        return false;
      }
    }

    if (searchValue) {
      const haystack = [
        row.subjectName,
        row.linkId,
        row.activityLocation,
        row.transactionCount,
        row.totalAmount,
        row.firstTransactionDate,
        row.lastTransactionDate,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchValue)) return false;
    }

    if (hasDateFilter) {
      const firstDate = row.firstTransactionDate
        ? new Date(row.firstTransactionDate)
        : null;
      const lastDate = row.lastTransactionDate
        ? new Date(row.lastTransactionDate)
        : null;
      if (!firstDate || !lastDate) return false;
      if (startDate && lastDate < startDate) return false;
      if (endDate && firstDate > endDate) return false;
    }

    return true;
  });
}

function applyTableSort(records) {
  const { sortKey, sortDir } = tableState;
  const sorted = [...records].sort((a, b) => compareValues(a, b, sortKey));
  if (sortDir === "desc") sorted.reverse();
  return sorted;
}

function compareValues(a, b, key) {
  const valueA = a[key];
  const valueB = b[key];
  if (key === "totalAmount" || key === "transactionCount") {
    return (Number(valueA) || 0) - (Number(valueB) || 0);
  }
  if (key === "riskLevel") {
    const priority = { TOP: 3, HIGH: 2, MODERATE: 1, LOW: 0 };
    return (priority[valueA] ?? -1) - (priority[valueB] ?? -1);
  }
  if (key === "firstTransactionDate" || key === "lastTransactionDate") {
    const dateA = valueA ? new Date(valueA).getTime() : 0;
    const dateB = valueB ? new Date(valueB).getTime() : 0;
    return dateA - dateB;
  }
  return String(valueA || "").localeCompare(String(valueB || ""));
}

function updateSortIndicators() {
  $(".sortable").removeClass("sorted-asc sorted-desc");
  $(`.sortable[data-sort="${tableState.sortKey}"]`).addClass(
    tableState.sortDir === "asc" ? "sorted-asc" : "sorted-desc",
  );
}

function parseBsaCsv(csvText) {
  const rows = parseCsvToRows(csvText);
  if (!rows.length) return [];

  const header = rows[0].map((h) => String(h || "").trim());
  const records = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || !row.length) continue;

    const record = {};
    header.forEach((key, idx) => {
      record[key] = row[idx] !== undefined ? String(row[idx]).trim() : "";
    });

    const subjectName = record["Subject Name"] || "";
    const subjectState = (record["Subject State"] || "").toUpperCase();
    const institutionState = (record["Filing Institution State"] || "").toUpperCase();
    const transactionDateRaw = record["Transaction Date"] || "";
    const transactionDate = parseUsDateToIso(transactionDateRaw);

    const amountTotal = parseCurrency(record["Amount Total"]);
    const totalCashIn = parseNumber(record["Total Cash In"]);
    const totalCashOut = parseNumber(record["Total Cash Out"]);

    const suspiciousActivityType = record["Suspicious Activity Type"] || "";
    const txTypeRaw = record["Transaction Type"] || "";
    const transactionType = (txTypeRaw || pickPrimaryActivityToken(suspiciousActivityType) || "UNKNOWN").trim();

    const bsaId = record["BSA ID"] || "";
    const formType = record["Form Type"] || "";

    const einSsn = record["Subject EIN/SSN"] || "";
    const zip3 = deriveZip3(einSsn, subjectName, subjectState);
    const riskLevel = deriveRiskLevel(amountTotal);
    const criminalHistory = deriveCriminalHistory(subjectName, zip3);

    records.push({
      id: String(record["Record #"] || i),
      bsaId,
      formType,
      transactionDate,
      amountTotal,
      suspiciousActivityType,
      totalCashIn,
      totalCashOut,
      transactionType,
      subjectName,
      subjectState,
      institutionState,
      zip3,
      riskLevel,
      criminalHistory,
    });
  }

  return records.filter((r) => r.subjectName);
}

function parseCsvToRows(csvText) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((v) => String(v || "").trim() !== ""));
}

function parseCurrency(value) {
  if (!value) return 0;
  const normalized = String(value)
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNumber(value) {
  if (!value) return 0;
  const normalized = String(value).replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseUsDateToIso(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return raw;
  const mm = match[1].padStart(2, "0");
  const dd = match[2].padStart(2, "0");
  const yyyy = match[3];
  return `${yyyy}-${mm}-${dd}`;
}

function deriveRiskLevel(amountTotal) {
  const amount = Number(amountTotal) || 0;
  if (amount >= 50000) return "TOP";
  if (amount >= 20000) return "HIGH";
  if (amount >= 5000) return "MODERATE";
  return "LOW";
}

function pickPrimaryActivityToken(activityText) {
  if (!activityText) return "";
  const firstSegment = String(activityText).split(";")[0] || "";
  const token = firstSegment.split(",")[0] || "";
  return token.trim();
}

function deriveZip3(einSsn, subjectName, subjectState) {
  const digits = String(einSsn || "").replace(/\D/g, "");
  if (digits.length >= 3) return digits.slice(0, 3);
  const seed = hashString(`${subjectName || ""}-${subjectState || ""}-${einSsn || ""}`);
  return String(100 + (seed % 900));
}

function applyAppFilters(records, activeFilters) {
  const current = activeFilters || {};
  return records.filter((row) => {
    if (current.subjectName && current.subjectName !== "all" && row.subjectName !== current.subjectName) {
      return false;
    }
    if (current.riskLevel && current.riskLevel !== "all" && row.riskLevel !== current.riskLevel) {
      return false;
    }
    if (current.transactionType && current.transactionType !== "all" && row.transactionType !== current.transactionType) {
      return false;
    }
    if (current.residenceState && current.residenceState !== "all" && row.subjectState !== current.residenceState) {
      return false;
    }
    if (current.activityState && current.activityState !== "all" && row.institutionState !== current.activityState) {
      return false;
    }
    if (current.criminalHistory && current.criminalHistory !== "all") {
      const history = String(row.criminalHistory || "").toLowerCase();
      const hasHistory = history && history !== "n";
      if (current.criminalHistory === "any" && !hasHistory) return false;
      if (current.criminalHistory === "none" && hasHistory) return false;
      if (["violent", "financial", "felony"].includes(current.criminalHistory)) {
        if (!hasHistory || !history.includes(current.criminalHistory)) return false;
      }
    }
    return true;
  });
}

function buildSubjectRelations(records) {
  const metricMaps = {
    subjectState: new Map(),
    zip3: new Map(),
    institutionState: new Map(),
    riskLevel: new Map(),
    activityType: new Map(),
    transactionType: new Map(),
    bsaId: new Map(),
    formType: new Map(),
  };

  const addMetric = (map, value, subject) => {
    if (!value) return;
    const key = String(value).trim().toLowerCase();
    if (!key || key === "—") return;
    const set = map.get(key) || new Set();
    set.add(subject);
    map.set(key, set);
  };

  records.forEach((row) => {
    const subject = row.subjectName;
    if (!subject) return;
    addMetric(metricMaps.subjectState, row.subjectState, subject);
    addMetric(metricMaps.zip3, row.zip3, subject);
    addMetric(metricMaps.institutionState, row.institutionState, subject);
    addMetric(metricMaps.riskLevel, row.riskLevel, subject);
    addMetric(metricMaps.activityType, row.suspiciousActivityType, subject);
    addMetric(metricMaps.transactionType, row.transactionType, subject);
    addMetric(metricMaps.bsaId, normalizeBsaId(row.bsaId), subject);
    addMetric(metricMaps.formType, row.formType, subject);
  });

  const relatedSubjects = new Set();
  const bySubject = new Map();

  const registerGroup = (subjects) => {
    if (subjects.size < 2) return;
    const list = Array.from(subjects);
    list.forEach((subject) => {
      relatedSubjects.add(subject);
      const related = bySubject.get(subject) || new Set();
      list.forEach((other) => {
        if (other !== subject) related.add(other);
      });
      bySubject.set(subject, related);
    });
  };

  Object.values(metricMaps).forEach((map) => {
    map.forEach((subjects) => registerGroup(subjects));
  });

  return { relatedSubjects, bySubject };
}

function selectLinkedSubjects(ranked, relationIndex, targetRate) {
  const subjects = ranked.map((row) => row.subjectName).filter(Boolean);
  const subjectSet = new Set(subjects);
  const visited = new Set();
  const components = [];

  subjects.forEach((subject) => {
    if (visited.has(subject)) return;
    const queue = [subject];
    const component = new Set();
    visited.add(subject);

    while (queue.length) {
      const current = queue.shift();
      component.add(current);
      const neighbors = relationIndex.get(current);
      if (!neighbors) continue;
      neighbors.forEach((neighbor) => {
        if (!subjectSet.has(neighbor) || visited.has(neighbor)) return;
        visited.add(neighbor);
        queue.push(neighbor);
      });
    }

    if (component.size >= 2) {
      components.push(component);
    }
  });

  if (!components.length || targetRate <= 0) return new Set();

  let targetCount = Math.round(subjects.length * targetRate);
  if (targetCount < 2) return new Set();
  if (targetCount % 2 !== 0) targetCount -= 1;
  if (targetCount < 2) return new Set();

  const pairs = [];
  components.forEach((component) => {
    const list = Array.from(component).sort();
    for (let i = 0; i + 1 < list.length; i += 2) {
      const a = list[i];
      const b = list[i + 1];
      const key = `${a}|${b}`;
      pairs.push({ pair: [a, b], hash: hashString(key) });
    }
  });

  const sortedPairs = pairs.sort((a, b) => a.hash - b.hash);
  const selected = new Set();
  let total = 0;
  for (const { pair } of sortedPairs) {
    if (total + 2 > targetCount) break;
    pair.forEach((name) => selected.add(name));
    total += 2;
    if (total >= targetCount) break;
  }

  return selected;
}

function buildFiltersFromRecords(records) {
  const subjects = new Set();
  const transactionTypes = new Set();
  const riskLevels = new Set();
  const residenceStates = new Set();
  const activityStates = new Set();

  records.forEach((row) => {
    if (row.subjectName) subjects.add(row.subjectName);
    if (row.transactionType) transactionTypes.add(row.transactionType);
    if (row.riskLevel) riskLevels.add(row.riskLevel);
    if (row.subjectState) residenceStates.add(row.subjectState);
    if (row.institutionState) activityStates.add(row.institutionState);
  });

  const sortedSubjects = Array.from(subjects).sort((a, b) => a.localeCompare(b));
  const sortedTypes = Array.from(transactionTypes).sort((a, b) => a.localeCompare(b));
  const sortedRisks = riskOrder.filter((r) => riskLevels.has(r));
  const sortedResidence = Array.from(residenceStates).sort((a, b) => a.localeCompare(b));
  const sortedActivity = Array.from(activityStates).sort((a, b) => a.localeCompare(b));

  return {
    subjects: sortedSubjects,
    transactionTypes: sortedTypes,
    riskLevels: sortedRisks,
    residenceStates: sortedResidence,
    activityStates: sortedActivity,
  };
}

function buildSummaryFromRecords(records) {
  const totalTransactions = records.length;
  const sums = records.reduce(
    (acc, row) => {
      acc.totalAmount += Number(row.amountTotal) || 0;
      if (row.subjectName) acc.subjects.add(row.subjectName);
      if (row.transactionDate) {
        const ts = new Date(row.transactionDate).getTime();
        if (!Number.isNaN(ts)) {
          acc.minTs = acc.minTs === null ? ts : Math.min(acc.minTs, ts);
          acc.maxTs = acc.maxTs === null ? ts : Math.max(acc.maxTs, ts);
        }
      }
      return acc;
    },
    { totalAmount: 0, subjects: new Set(), minTs: null, maxTs: null },
  );

  const averageAmount = totalTransactions ? sums.totalAmount / totalTransactions : 0;

  return {
    totalTransactions,
    totalAmount: sums.totalAmount,
    averageAmount,
    uniqueSubjects: sums.subjects.size,
    oldestTransactionDate: sums.minTs ? new Date(sums.minTs).toISOString() : null,
    newestTransactionDate: sums.maxTs ? new Date(sums.maxTs).toISOString() : null,
  };
}

function buildRiskAmountsFromRecords(records) {
  const riskPriority = { TOP: 3, HIGH: 2, MODERATE: 1, LOW: 0 };
  const subjectRisk = new Map();

  records.forEach((row) => {
    if (!row.subjectName) return;
    const risk = row.riskLevel || "LOW";
    const current = subjectRisk.get(row.subjectName);
    if (!current || riskPriority[risk] > riskPriority[current]) {
      subjectRisk.set(row.subjectName, risk);
    }
  });

  const totals = { TOP: 0, HIGH: 0, MODERATE: 0, LOW: 0 };
  subjectRisk.forEach((risk) => {
    totals[risk] = (totals[risk] || 0) + 1;
  });

  return totals;
}

function buildLinkId(subjectState, zip3, subjectName) {
  const group = hashString(String(subjectName || "")) % 4;
  const bucket = zip3 || subjectState || "000";
  const seed = `${bucket}-${group}`;
  return hashString(seed).toString(16).toUpperCase().padStart(6, "0").slice(0, 6);
}

function buildSubjectRankingsFromRecords(records) {
  const map = new Map();
  const riskPriority = { TOP: 3, HIGH: 2, MODERATE: 1, LOW: 0 };

  records.forEach((row) => {
    const key = row.subjectName;
    if (!map.has(key)) {
      map.set(key, {
        subjectName: row.subjectName,
        subjectState: row.subjectState,
        zip3: row.zip3,
        states: new Set(),
        transactionCount: 0,
        totalAmount: 0,
        riskLevel: row.riskLevel || "LOW",
        firstTransactionDate: null,
        lastTransactionDate: null,
      });
    }
    const agg = map.get(key);
    agg.transactionCount += 1;
    agg.totalAmount += Number(row.amountTotal) || 0;
    if (row.subjectState) agg.states.add(row.subjectState);
    if (row.institutionState) agg.states.add(row.institutionState);
    if (!agg.subjectState && row.subjectState) agg.subjectState = row.subjectState;
    if (!agg.zip3 && row.zip3) agg.zip3 = row.zip3;
    if (row.riskLevel && riskPriority[row.riskLevel] > riskPriority[agg.riskLevel]) {
      agg.riskLevel = row.riskLevel;
    }

    const ts = row.transactionDate ? new Date(row.transactionDate).getTime() : null;
    if (ts !== null && !Number.isNaN(ts)) {
      if (!agg.firstTransactionDate || new Date(agg.firstTransactionDate).getTime() > ts) {
        agg.firstTransactionDate = row.transactionDate;
      }
      if (!agg.lastTransactionDate || new Date(agg.lastTransactionDate).getTime() < ts) {
        agg.lastTransactionDate = row.transactionDate;
      }
    }
  });

  const ranked = Array.from(map.values())
    .sort((a, b) => (b.transactionCount - a.transactionCount) || (b.totalAmount - a.totalAmount))
    .slice(0, 50)
    .map((item, index) => {
      let linkId = buildLinkId(item.subjectState, item.zip3, item.subjectName);
      if (index < 4) linkId = "DEMO01";
      if (index >= 4 && index < 8) linkId = "DEMO02";
      const activityLocation = Array.from(item.states)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .join(", ");

      return {
        subjectName: item.subjectName,
        linkId,
        transactionCount: item.transactionCount,
        totalAmount: item.totalAmount,
        riskLevel: item.riskLevel,
        activityLocation: activityLocation || null,
        firstTransactionDate: item.firstTransactionDate,
        lastTransactionDate: item.lastTransactionDate,
      };
    });

  return ranked;
}

function buildSubjectDetailsFromRecords(records, params) {
  const subjectName = params.subjectName;
  const filtered = applyAppFilters(records, params).filter((r) => r.subjectName === subjectName);

  const summary = filtered.reduce(
    (acc, row) => {
      acc.transactionCount += 1;
      acc.totalAmount += Number(row.amountTotal) || 0;
      acc.totalCashIn += Number(row.totalCashIn) || 0;
      acc.totalCashOut += Number(row.totalCashOut) || 0;
      const ts = row.transactionDate ? new Date(row.transactionDate).getTime() : null;
      if (ts !== null && !Number.isNaN(ts)) {
        acc.minTs = acc.minTs === null ? ts : Math.min(acc.minTs, ts);
        acc.maxTs = acc.maxTs === null ? ts : Math.max(acc.maxTs, ts);
      }
      return acc;
    },
    { transactionCount: 0, totalAmount: 0, totalCashIn: 0, totalCashOut: 0, minTs: null, maxTs: null },
  );

  const transactions = filtered
    .slice()
    .sort((a, b) => {
      const dateA = a.transactionDate ? new Date(a.transactionDate).getTime() : 0;
      const dateB = b.transactionDate ? new Date(b.transactionDate).getTime() : 0;
      if (dateA !== dateB) return dateB - dateA;
      return (Number(b.amountTotal) || 0) - (Number(a.amountTotal) || 0);
    })
    .slice(0, 20)
    .map((tx, idx) => ({
      id: tx.id || String(idx + 1),
      bsaId: tx.bsaId,
      formType: tx.formType,
      transactionDate: tx.transactionDate,
      amountTotal: tx.amountTotal,
      suspiciousActivityType: tx.suspiciousActivityType,
      transactionType: tx.transactionType,
      subjectState: tx.subjectState,
      institutionState: tx.institutionState,
      zip3: tx.zip3,
      riskLevel: tx.riskLevel,
    }));

  return {
    subjectName,
    transactionCount: summary.transactionCount,
    totalAmount: summary.totalAmount,
    totalCashIn: summary.totalCashIn,
    totalCashOut: summary.totalCashOut,
    firstTransactionDate: summary.minTs ? new Date(summary.minTs).toISOString() : null,
    lastTransactionDate: summary.maxTs ? new Date(summary.maxTs).toISOString() : null,
    transactions,
  };
}

function buildLinkIdDetailsFromRecords(records, params) {
  const linkId = params.linkId;
  const relatedSet = Array.isArray(params.relatedSubjects)
    ? new Set(params.relatedSubjects)
    : null;
  const filtered = applyAppFilters(records, params).filter((row) => {
    if (relatedSet) return relatedSet.has(row.subjectName);
    const computed = buildLinkId(row.subjectState, row.zip3, row.subjectName);
    return computed === linkId;
  });

  const summary = filtered.reduce(
    (acc, row) => {
      acc.transactionCount += 1;
      acc.totalAmount += Number(row.amountTotal) || 0;
      acc.totalCashIn += Number(row.totalCashIn) || 0;
      acc.totalCashOut += Number(row.totalCashOut) || 0;
      const ts = row.transactionDate ? new Date(row.transactionDate).getTime() : null;
      if (ts !== null && !Number.isNaN(ts)) {
        acc.minTs = acc.minTs === null ? ts : Math.min(acc.minTs, ts);
        acc.maxTs = acc.maxTs === null ? ts : Math.max(acc.maxTs, ts);
      }
      return acc;
    },
    { transactionCount: 0, totalAmount: 0, totalCashIn: 0, totalCashOut: 0, minTs: null, maxTs: null },
  );

  const entitiesByName = new Map();
  filtered.forEach((row) => {
    const entityName = row.subjectName || "Unknown";
    if (!entitiesByName.has(entityName)) {
      entitiesByName.set(entityName, {
        subjectName: entityName,
        transactionCount: 0,
        totalAmount: 0,
        activityLocations: new Set(),
        minTs: null,
        maxTs: null,
      });
    }

    const entity = entitiesByName.get(entityName);
    entity.transactionCount += 1;
    entity.totalAmount += Number(row.amountTotal) || 0;

    if (row.institutionState) entity.activityLocations.add(row.institutionState);
    if (row.subjectState) entity.activityLocations.add(row.subjectState);

    const ts = row.transactionDate ? new Date(row.transactionDate).getTime() : null;
    if (ts !== null && !Number.isNaN(ts)) {
      entity.minTs = entity.minTs === null ? ts : Math.min(entity.minTs, ts);
      entity.maxTs = entity.maxTs === null ? ts : Math.max(entity.maxTs, ts);
    }
  });

  const entities = Array.from(entitiesByName.values())
    .sort((a, b) => (b.transactionCount - a.transactionCount) || (b.totalAmount - a.totalAmount))
    .map((entity) => ({
      subjectName: entity.subjectName,
      transactionCount: entity.transactionCount,
      totalAmount: entity.totalAmount,
      activityLocation: Array.from(entity.activityLocations)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .join(", "),
      minTransactionDate: entity.minTs ? new Date(entity.minTs).toISOString() : null,
      maxTransactionDate: entity.maxTs ? new Date(entity.maxTs).toISOString() : null,
    }));

  return {
    linkId,
    description: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. LinkID ${linkId} tempor incididunt ut labore et dolore magna aliqua.`,
    entityCount: entities.length,
    transactionCount: summary.transactionCount,
    totalAmount: summary.totalAmount,
    totalCashIn: summary.totalCashIn,
    totalCashOut: summary.totalCashOut,
    firstTransactionDate: summary.minTs ? new Date(summary.minTs).toISOString() : null,
    lastTransactionDate: summary.maxTs ? new Date(summary.maxTs).toISOString() : null,
    entities,
  };
}
