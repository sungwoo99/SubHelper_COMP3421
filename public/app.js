/* ==========================================================================
   SubTrack — Client-Side Application Logic (Full-Stack Version)
   ========================================================================== */

let myBarChart = null;
let myDoughnutChart = null;

const API_BASE_URL = "";

const STORAGE_KEYS = {
  THEME: "subtrack_theme",
  CURRENCY: "subtrack_currency"
};

const EXCHANGE_RATES = { USD: 1, KRW: 1400, HKD: 7.8 };
const CURRENCY_SYMBOLS = { USD: "$", KRW: "₩", HKD: "HK$" };
let currentCurrency = "USD";

let subscriptions = [];
let budgets = [];

/* ==========================================================================
   API Fetch Functions (Server Communication)
   ========================================================================== */

// 1. 서버에서 데이터 가져오기 (Read)
async function loadDataFromServer() {
  try {
    // 환율 데이터 안전 조회 (실패해도 앱이 멈추지 않음)
    try {
      const rateRes = await fetch(`${API_BASE_URL}/rates`);
      if (rateRes.ok) {
        const rates = await rateRes.json();
        if (rates.KRW && rates.HKD) {
          EXCHANGE_RATES.KRW = rates.KRW;
          EXCHANGE_RATES.HKD = rates.HKD;
        }
      }
    } catch (rateErr) {
      console.warn("환율 조회 실패, 기본 환율을 적용합니다:", rateErr);
    }

    // 구독 및 예산 데이터 조회
    const [subRes, budgetRes] = await Promise.all([
      fetch(`${API_BASE_URL}/subscriptions`),
      fetch(`${API_BASE_URL}/budgets`)
    ]);

    if (!subRes.ok || !budgetRes.ok) {
      throw new Error('Failed to fetch subscriptions or budgets');
    }

    subscriptions = await subRes.json();
    budgets = await budgetRes.json();

    // 화면 렌더링 실행
    renderAll();
  } catch (error) {
    console.error("Error loading data:", error);
  }
}

// 2. 서버에 데이터 추가하기 (Create)
async function createData(endpoint, data) {
  try {
    const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to create data');
    await loadDataFromServer(); // 성공 시 서버에서 최신 데이터 다시 불러오기
  } catch (error) {
    console.error(`Error creating ${endpoint}:`, error);
  }
}

// 3. 서버 데이터 수정하기 (Update)
async function updateData(endpoint, id, data) {
  try {
    const response = await fetch(`${API_BASE_URL}/${endpoint}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to update data');
    await loadDataFromServer();
  } catch (error) {
    console.error(`Error updating ${endpoint}:`, error);
  }
}

// 4. 서버 데이터 삭제하기 (Delete)
async function deleteData(endpoint, id) {
  try {
    const response = await fetch(`${API_BASE_URL}/${endpoint}/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete data');
    await loadDataFromServer();
  } catch (error) {
    console.error(`Error deleting ${endpoint}:`, error);
  }
}

/* ==========================================================================
   Calculation & Formatting Helpers
   ========================================================================== */
function formatCurrency(amountInUSD) {
  const rate = EXCHANGE_RATES[currentCurrency] || 1;
  const converted = amountInUSD * rate;
  if (currentCurrency === "KRW") {
    return `${CURRENCY_SYMBOLS[currentCurrency]}${Math.round(converted).toLocaleString()}`;
  }
  return `${CURRENCY_SYMBOLS[currentCurrency]}${converted.toFixed(2)}`;
}

function getMonthlyEquivalent(sub) {
  if (!sub.isActive) return 0;
  return sub.billingCycle === "yearly" ? sub.cost / 12 : sub.cost;
}

function getDaysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  const diffTime = target - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/* ==========================================================================
   DOM Rendering Functions (Read Flows)
   ========================================================================== */
function renderAll() {
  updateCurrencyLabels();
  populateCategorySelects();
  renderDashboard();
  renderDirectory();
  renderBudgetsView();
}

function updateCurrencyLabels() {
  const costLabel = document.getElementById("label-sub-cost");
  const budgetLabel = document.getElementById("label-budget-cap");
  if (costLabel) costLabel.textContent = `Billing Amount (${currentCurrency}) *`;
  if (budgetLabel) budgetLabel.textContent = `Monthly Cap (${currentCurrency}) *`;

  // 예산 입력 폼의 통화 드롭다운도 현재 통화로 자동 변경
  const budgetCurrencySelect = document.getElementById("budget-currency");
  if (budgetCurrencySelect) {
    budgetCurrencySelect.value = currentCurrency;
  }

  // 만약 예산 수정(Edit) 중일 때 상단 통화를 바꾸면 입력창에 적힌 금액도 즉시 환산
  const editingBudgetId = document.getElementById("budget-id")?.value;
  if (editingBudgetId) {
    const b = budgets.find((item) => item.id === editingBudgetId);
    if (b) {
      const rate = EXCHANGE_RATES[currentCurrency] || 1;
      const convertedCap = b.monthlyCap * rate;
      document.getElementById("budget-monthly-cap").value =
        currentCurrency === "KRW" ? Math.round(convertedCap) : convertedCap.toFixed(2);
    }
  }
}

function populateCategorySelects() {
  const filterCat = document.getElementById("filter-category");
  const modalCat = document.getElementById("sub-category");
  if (!filterCat || !modalCat) return;

  const currentFilterVal = filterCat.value;
  const categories = budgets.map((b) => b.categoryName);

  filterCat.innerHTML = `<option value="ALL">All Categories</option>` +
    categories.map((c) => `<option value="${c}">${c}</option>`).join("");

  if (categories.includes(currentFilterVal)) filterCat.value = currentFilterVal;
  modalCat.innerHTML = categories.map((c) => `<option value="${c}">${c}</option>`).join("");
}

function renderCharts() {
  const activeSubs = subscriptions.filter(s => s.isActive);
  const rate = EXCHANGE_RATES[currentCurrency] || 1;
  const symbol = CURRENCY_SYMBOLS[currentCurrency] || "$";

  // 다크모드 여부 확인 및 차트 내부 텍스트/그리드 색상 설정
  const isDark = document.body.classList.contains("dark");
  const textColor = isDark ? "#f8fafc" : "#1e293b";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)";

  // 1. 도넛 차트 데이터: 통화에 상관없이 카테고리별 비율(%)로 계산 (소수점 제거)
  const catTotals = {};
  budgets.forEach(b => catTotals[b.categoryName] = 0);
  activeSubs.forEach(s => {
    if (catTotals[s.category] !== undefined) {
      catTotals[s.category] += getMonthlyEquivalent(s);
    }
  });

  const totalMonthlyUSD = Object.values(catTotals).reduce((sum, val) => sum + val, 0);
  const catPercentages = Object.values(catTotals).map(val =>
    totalMonthlyUSD > 0 ? Math.round((val / totalMonthlyUSD) * 100) : 0
  );

  // 2. 바 차트 데이터: 현재 선택된 통화(currentCurrency)로 환산 후 소수점 반올림 제거
  const monthlyData = new Array(12).fill(0);
  activeSubs.forEach(s => {
    const convertedCost = s.cost * rate;
    if (s.billingCycle === 'monthly') {
      for (let i = 0; i < 12; i++) monthlyData[i] += convertedCost;
    } else if (s.billingCycle === 'yearly') {
      const month = new Date(s.nextRenewalDate).getMonth();
      monthlyData[month] += convertedCost;
    }
  });

  // 모든 월별 데이터를 정수로 변환 (소수점 완전 제거)
  const roundedMonthlyData = monthlyData.map(val => Math.round(val));

  const maxMonthValue = Math.max(...roundedMonthlyData);
  const barColors = roundedMonthlyData.map(val =>
    val === maxMonthValue && val > 0 ? 'rgba(255, 99, 132, 0.75)' : 'rgba(54, 162, 235, 0.75)'
  );
  const barBorderColors = roundedMonthlyData.map(val =>
    val === maxMonthValue && val > 0 ? 'rgba(255, 99, 132, 1)' : 'rgba(54, 162, 235, 1)'
  );

  if (myBarChart) myBarChart.destroy();
  if (myDoughnutChart) myDoughnutChart.destroy();

  // 바 차트 생성
  const ctxBar = document.getElementById('monthlyBarChart').getContext('2d');
  myBarChart = new Chart(ctxBar, {
    type: 'bar',
    data: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      datasets: [{
        label: `Spending (${currentCurrency})`,
        data: roundedMonthlyData,
        backgroundColor: barColors,
        borderColor: barBorderColors,
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      scales: {
        x: {
          ticks: { color: textColor },
          grid: { color: gridColor }
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: textColor,
            precision: 0, // Y축 소수점 방지
            callback: function(value) {
              return symbol + Math.round(value).toLocaleString();
            }
          },
          grid: { color: gridColor }
        }
      },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `Expected Monthly Spending Trend (${currentCurrency})`,
          color: textColor,
          font: { size: 14, weight: 'bold' }
        },
        tooltip: {
          callbacks: {
            // 마우스 커서를 올렸을 때 소수점 없이 정수와 통화기호만 출력
            label: function(context) {
              return ` ${symbol}${Math.round(context.parsed.y).toLocaleString()}`;
            }
          }
        }
      }
    }
  });

  // 도넛 차트 생성
  const ctxDoughnut = document.getElementById('categoryDoughnutChart').getContext('2d');
  myDoughnutChart = new Chart(ctxDoughnut, {
    type: 'doughnut',
    data: {
      labels: Object.keys(catTotals),
      datasets: [{
        data: catPercentages,
        backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'],
        borderColor: isDark ? '#1e293b' : '#ffffff',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          labels: { color: textColor }
        },
        title: {
          display: true,
          text: 'Monthly Spending by Category (%)',
          color: textColor,
          font: { size: 14, weight: 'bold' }
        },
        tooltip: {
          callbacks: {
            // 마우스 커서를 올렸을 때 소수점 없이 정수 퍼센트(%)로만 출력
            label: function(context) {
              return ` ${context.label}: ${Math.round(context.parsed)}%`;
            }
          }
        }
      }
    }
  });
}



function renderDashboard() {
  const activeSubs = subscriptions.filter((s) => s.isActive);
  const pausedCount = subscriptions.length - activeSubs.length;

  const totalMonthly = activeSubs.reduce((sum, s) => sum + getMonthlyEquivalent(s), 0);
  const totalAnnual = totalMonthly * 12;

  const dueSoonSubs = activeSubs
    .map((s) => ({ ...s, daysLeft: getDaysUntil(s.nextRenewalDate) }))
    .filter((s) => s.daysLeft >= 0 && s.daysLeft <= 14)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  document.getElementById("kpi-monthly").textContent = formatCurrency(totalMonthly);
  document.getElementById("kpi-annual").textContent = formatCurrency(totalAnnual);
  document.getElementById("kpi-active-count").textContent = activeSubs.length;
  document.getElementById("kpi-paused-count").textContent = `${pausedCount} paused`;
  document.getElementById("kpi-due-soon").textContent = dueSoonSubs.length;

  const barsContainer = document.getElementById("dashboard-budget-bars");
  barsContainer.innerHTML = budgets.map((b) => {
    const spent = activeSubs
      .filter((s) => s.category === b.categoryName)
      .reduce((sum, s) => sum + getMonthlyEquivalent(s), 0);

    const pct = Math.min(100, (spent / b.monthlyCap) * 100);
    let statusClass = "";
    if (spent > b.monthlyCap) statusClass = "danger";
    else if ((spent / b.monthlyCap) * 100 >= b.alertThreshold) statusClass = "warn";

    return `
      <div class="budget-item">
        <div class="budget-item-top">
          <strong>${b.categoryName}</strong>
          <span>${formatCurrency(spent)} / ${formatCurrency(b.monthlyCap)} (${Math.round((spent / b.monthlyCap) * 100)}%)</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill ${statusClass}" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  }).join("");

  const upcomingContainer = document.getElementById("dashboard-upcoming-list");
  const sortedActive = activeSubs
    .map((s) => ({ ...s, daysLeft: getDaysUntil(s.nextRenewalDate) }))
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 5);

  if (sortedActive.length === 0) {
    upcomingContainer.innerHTML = `<li class="upcoming-item">No active subscriptions found.</li>`;
    return;
  }

  upcomingContainer.innerHTML = sortedActive.map((s) => {
    const dLabel = s.daysLeft === 0 ? "D-Day" : s.daysLeft > 0 ? `D-${s.daysLeft}` : `Passed`;
    const urgentClass = s.daysLeft >= 0 && s.daysLeft <= 7 ? "urgent" : "";
    return `
      <li class="upcoming-item">
        <div>
          <strong>${s.name}</strong>
          <div class="sub-meta">${s.nextRenewalDate} · ${formatCurrency(s.cost)} (${s.billingCycle})</div>
        </div>
        <span class="dday-badge ${urgentClass}">${dLabel}</span>
      </li>
    `;
  }).join("");

  renderCharts();
}


function renderDirectory() {
  const search = document.getElementById("search-input").value.trim().toLowerCase();
  const catFilter = document.getElementById("filter-category").value;
  const statusFilter = document.getElementById("filter-status").value;
  const sortBy = document.getElementById("sort-select").value;

  let filtered = subscriptions.filter((s) => {
    const matchText = s.name.toLowerCase().includes(search) || (s.notes && s.notes.toLowerCase().includes(search));
    const matchCat = catFilter === "ALL" || s.category === catFilter;
    const matchStatus = statusFilter === "ALL" || (statusFilter === "ACTIVE" && s.isActive) || (statusFilter === "PAUSED" && !s.isActive);
    return matchText && matchCat && matchStatus;
  });

  filtered.sort((a, b) => {
    if (sortBy === "date-asc") return new Date(a.nextRenewalDate) - new Date(b.nextRenewalDate);
    if (sortBy === "cost-desc") return getMonthlyEquivalent(b) - getMonthlyEquivalent(a);
    return a.name.localeCompare(b.name);
  });

  const grid = document.getElementById("subscription-grid");
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="panel">No matching subscriptions found.</div>`;
    return;
  }

  grid.innerHTML = filtered.map((s) => `
    <article class="sub-card ${s.isActive ? "" : "paused"}">
      <div>
        <div class="sub-card-top">
          <div>
            <span class="badge">${s.category}</span>
            <h3 class="sub-card-title">${s.name}</h3>
          </div>
          <span class="sub-price">${formatCurrency(s.cost)}</span>
        </div>
        <p class="sub-meta">Cycle: <strong>${s.billingCycle}</strong> (${formatCurrency(getMonthlyEquivalent(s))}/mo)</p>
        <p class="sub-meta">Next Renewal: <strong>${s.nextRenewalDate}</strong></p>
        ${s.notes ? `<p class="sub-meta">Note: ${s.notes}</p>` : ""}
      </div>
      <div class="sub-actions">
        <button type="button" class="btn btn-sm btn-outline" onclick="editSubscription('${s.id}')">
          <i class="fa-solid fa-pen"></i> Edit
        </button>
        <button type="button" class="btn btn-sm btn-outline" onclick="toggleSubscriptionStatus('${s.id}')">
          ${s.isActive ? "Pause" : "Resume"}
        </button>
        <button type="button" class="btn btn-sm btn-danger" onclick="deleteSubscription('${s.id}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </article>
  `).join("");
}

function renderBudgetsView() {
  const tbody = document.getElementById("budget-table-body");
  tbody.innerHTML = budgets.map((b) => {
    const spent = subscriptions
      .filter((s) => s.isActive && s.category === b.categoryName)
      .reduce((sum, s) => sum + getMonthlyEquivalent(s), 0);

    return `
      <tr>
        <td><strong>${b.categoryName}</strong></td>
        <td>${formatCurrency(spent)}</td>
        <td>${formatCurrency(b.monthlyCap)}</td>
        <td>${b.alertThreshold}%</td>
        <td>
          <button type="button" class="btn btn-sm btn-outline" onclick="editBudget('${b.id}')">Edit</button>
          <button type="button" class="btn btn-sm btn-danger" onclick="deleteBudget('${b.id}')">Delete</button>
        </td>
      </tr>
    `;
  }).join("");
}

/* ==========================================================================
   CRUD: Subscription Operations & Validation
   ========================================================================== */
function openModal(editId = null) {
  const modal = document.getElementById("sub-modal");
  const form = document.getElementById("sub-form");
  const errorEl = document.getElementById("sub-form-error");
  errorEl.textContent = "";
  form.reset();

  const currencySelect = document.getElementById("sub-currency");

  if (editId) {
    const sub = subscriptions.find((s) => s.id === editId);
    if (!sub) return;
    document.getElementById("modal-title").textContent = "Edit Subscription";
    document.getElementById("sub-id").value = sub.id;
    document.getElementById("sub-name").value = sub.name;
    document.getElementById("sub-category").value = sub.category;
    document.getElementById("sub-cycle").value = sub.billingCycle;

    // 현재 선택된 통화 단위로 환산해서 보여줌
    const currentRate = EXCHANGE_RATES[currentCurrency] || 1;
    const convertedCost = sub.cost * currentRate;
    document.getElementById("sub-cost").value = (currentCurrency === "KRW" ? Math.round(convertedCost) : convertedCost.toFixed(2));
    if (currencySelect) currencySelect.value = currentCurrency;

    document.getElementById("sub-date").value = sub.nextRenewalDate;
    document.getElementById("sub-notes").value = sub.notes || "";
    document.getElementById("sub-active").checked = sub.isActive;
  } else {
    document.getElementById("modal-title").textContent = "Add Subscription";
    document.getElementById("sub-id").value = "";
    if (currencySelect) currencySelect.value = currentCurrency;
    const d = new Date(); d.setDate(d.getDate() + 7);
    document.getElementById("sub-date").value = d.toISOString().split("T")[0];
  }

  modal.classList.add("open");
}

function closeModal() {
  document.getElementById("sub-modal").classList.remove("open");
}

window.editSubscription = (id) => openModal(id);

window.toggleSubscriptionStatus = (id) => {
  const sub = subscriptions.find((s) => s.id === id);
  if (sub) {
    const updatedSub = { ...sub, isActive: !sub.isActive };
    updateData('subscriptions', id, updatedSub);
  }
};

window.deleteSubscription = (id) => {
  deleteData('subscriptions', id);
};

/* ==========================================================================
   CRUD: Category Budget Operations
   ========================================================================== */
window.editBudget = (id) => {
  const b = budgets.find((item) => item.id === id);
  if (!b) return;

  const rate = EXCHANGE_RATES[currentCurrency] || 1;
  const convertedCap = b.monthlyCap * rate;

  document.getElementById("budget-form-title").textContent = "Edit Category Budget";
  document.getElementById("budget-id").value = b.id;
  document.getElementById("budget-category-name").value = b.categoryName;
  document.getElementById("budget-monthly-cap").value =
    currentCurrency === "KRW" ? Math.round(convertedCap) : convertedCap.toFixed(2);
  document.getElementById("budget-alert-threshold").value = b.alertThreshold;

  const budgetCurrencySelect = document.getElementById("budget-currency");
  if (budgetCurrencySelect) {
    budgetCurrencySelect.value = currentCurrency;
  }
};

window.deleteBudget = (id) => {
  if (budgets.length <= 1) {
    document.getElementById("budget-form-error").textContent = "At least one category budget must remain.";
    return;
  }
  deleteData('budgets', id);
};

/* ==========================================================================
   Event Listeners & Initialization
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {

  // 통화 및 테마 설정 불러오기
  const rawCurrency = localStorage.getItem(STORAGE_KEYS.CURRENCY);
  if (rawCurrency) {
    currentCurrency = rawCurrency;
    const currencySelect = document.getElementById("global-currency");
    if (currencySelect) currencySelect.value = currentCurrency;
  }

  if (localStorage.getItem(STORAGE_KEYS.THEME) === "dark") {
    document.body.classList.add("dark");
  }

  // 서버에서 데이터 최초 로드
  loadDataFromServer();

  // Currency Switcher Logic
  // Currency Switcher Logic (DB 훼손 없이 즉시 화면 재렌더링)
  document.getElementById("global-currency").addEventListener("change", (e) => {
    currentCurrency = e.target.value;
    localStorage.setItem(STORAGE_KEYS.CURRENCY, currentCurrency);
    renderAll();
  });

  // Navigation Tabs Switching
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".view-section").forEach((v) => v.classList.remove("active"));

      tab.classList.add("active");
      const targetId = tab.getAttribute("data-target");
      document.getElementById(targetId).classList.add("active");
    });
  });

  // Theme Toggle
  document.getElementById("theme-toggle-btn").addEventListener("click", () => {
    document.body.classList.toggle("dark");
    const isDark = document.body.classList.contains("dark");
    localStorage.setItem(STORAGE_KEYS.THEME, isDark ? "dark" : "light");
    renderCharts(); // <-- 다크모드 전환 시 차트 색상도 즉시 업데이트
  });

  // Modal Open/Close
  document.getElementById("open-add-modal-btn").addEventListener("click", () => openModal());
  document.getElementById("close-modal-btn").addEventListener("click", closeModal);
  document.getElementById("cancel-modal-btn").addEventListener("click", closeModal);

  // Filter & Search Listeners
  ["search-input", "filter-category", "filter-status", "sort-select"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderDirectory);
  });

  // Subscription Form Submit (POST or PUT)
  // Subscription Form Submit (POST or PUT)
  document.getElementById("sub-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("sub-id").value;
    const name = document.getElementById("sub-name").value.trim();
    const category = document.getElementById("sub-category").value;
    const billingCycle = document.getElementById("sub-cycle").value;
    const rawCost = parseFloat(document.getElementById("sub-cost").value);
    const selectedCurrency = document.getElementById("sub-currency") ? document.getElementById("sub-currency").value : currentCurrency;
    const nextRenewalDate = document.getElementById("sub-date").value;
    const notes = document.getElementById("sub-notes").value.trim();
    const isActive = document.getElementById("sub-active").checked;
    const errorEl = document.getElementById("sub-form-error");

    if (!name || !category || isNaN(rawCost) || rawCost <= 0 || !nextRenewalDate) {
      errorEl.textContent = `Please enter a valid service name, positive cost, and renewal date.`;
      return;
    }

    // 💡 입력된 통화 금액을 DB 저장용 기준 통화(USD)로 자동 환산
    const rate = EXCHANGE_RATES[selectedCurrency] || 1;
    const costInUSD = rawCost / rate;

    const subData = {
      id: id || "sub_" + Date.now(),
      name,
      category,
      billingCycle,
      cost: costInUSD, // USD 값으로 저장
      nextRenewalDate,
      isActive,
      notes
    };

    if (id) {
      updateData('subscriptions', id, subData);
    } else {
      createData('subscriptions', subData);
    }
    closeModal();
  });

  
  // Budget Form Submit (POST or PUT)
  document.getElementById("budget-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("budget-id").value;
    const categoryName = document.getElementById("budget-category-name").value.trim();
    const rawCap = parseFloat(document.getElementById("budget-monthly-cap").value);
    const budgetCurrencyEl = document.getElementById("budget-currency");
    const selectedCurrency = budgetCurrencyEl ? budgetCurrencyEl.value : currentCurrency;
    const alertThreshold = parseInt(document.getElementById("budget-alert-threshold").value, 10);
    const errorEl = document.getElementById("budget-form-error");

    if (!categoryName || isNaN(rawCap) || rawCap <= 0 || isNaN(alertThreshold) || alertThreshold < 10 || alertThreshold > 100) {
      errorEl.textContent = "Please provide a valid category name, a positive cap, and a threshold between 10 and 100.";
      return;
    }

    errorEl.textContent = "";

    // 입력된 예산 한도를 DB 기준 통화(USD)로 자동 환산
    const rate = EXCHANGE_RATES[selectedCurrency] || 1;
    const monthlyCapInUSD = rawCap / rate;

    const budgetData = {
      id: id || "b_" + Date.now(),
      categoryName,
      monthlyCap: monthlyCapInUSD,
      alertThreshold
    };

    if (id) {
      updateData("budgets", id, budgetData);
    } else {
      createData("budgets", budgetData);
    }

    document.getElementById("budget-form").reset();
    document.getElementById("budget-id").value = "";
    document.getElementById("budget-form-title").textContent = "Set Category Budget";
    if (budgetCurrencyEl) budgetCurrencyEl.value = currentCurrency;
  });

  document.getElementById("budget-reset-btn").addEventListener("click", () => {
    document.getElementById("budget-form").reset();
    document.getElementById("budget-id").value = "";
    document.getElementById("budget-form-title").textContent = "Set Category Budget";
    document.getElementById("budget-form-error").textContent = "";
  });


});