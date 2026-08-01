const STORAGE_KEY = "calismaKazancMvp.v2";
const OLD_STORAGE_KEY = "calismaKazancMvp.v1";
const SAFETY_BACKUP_KEY = `${STORAGE_KEY}.beforeImport`;
const BACKUP_FORMAT = "calisma-kazanc-backup";
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const THEME_STORAGE_KEY = "calismaKazancMvp.theme";
const QUICK_PREFS_KEY = "calismaKazancMvp.quickPrefs";

const defaultState = {
  version: 2,
  settings: {
    hourlyRate: 500,
    defaultCommissionRate: 10,
    monthlySalesTarget: 100000,
    monthlyIncomeTarget: 50000,
    dailyWorkTargetHours: 6
  },
  customers: [],
  projects: [],
  workSessions: [],
  todos: [],
  sales: [],
  expenses: [],
  timer: null
};

let state = loadState();
let selectedPeriod = "day";
let customPeriodRange = null;
let timerInterval = null;
let generatedReportRange = null;
let pendingSlotTime = null;
let activeNotesCustomerId = null;
let editingNoteId = null;

function loadQuickPrefs() {
  try { return JSON.parse(localStorage.getItem(QUICK_PREFS_KEY) || "{}"); }
  catch { return {}; }
}

function rememberFormChoices(data) {
  const current = loadQuickPrefs();
  const next = { ...current };
  if ("customerId" in data) next.customerId = String(data.customerId || "");
  if ("projectId" in data) next.projectId = String(data.projectId || "");
  if (data.commissionRate) next.commissionRate = data.commissionRate;
  localStorage.setItem(QUICK_PREFS_KEY, JSON.stringify(next));
}

function roundedTimeRange() {
  const now = new Date();
  const startMinutes = Math.min(23 * 60, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15);
  const endMinutes = Math.min(23 * 60 + 59, startMinutes + 60);
  const asTime = value => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return { start: asTime(startMinutes), end: asTime(endMinutes) };
}

function preferredTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme, persist = false) {
  const resolved = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#0b1020" : "#f5f7fb");
  const toggle = document.querySelector("#themeToggle");
  if (toggle) {
    const dark = resolved === "dark";
    toggle.setAttribute("aria-pressed", String(dark));
    toggle.setAttribute("aria-label", dark ? "Açık temaya geç" : "Koyu temaya geç");
    const label = toggle.querySelector(".theme-toggle-label");
    if (label) label.textContent = dark ? "Açık" : "Koyu";
  }
  if (persist) localStorage.setItem(THEME_STORAGE_KEY, resolved);
}

applyTheme(preferredTheme());

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function localTimeString(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function parseLocalDate(value) {
  if (!value) return new Date(NaN);
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function addMonths(date, amount) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + amount);
  return copy;
}

function startOfWeek(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  return copy;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatMoney(value) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatDate(value, options = { day: "numeric", month: "short" }) {
  const date = parseLocalDate(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("tr-TR", options);
}

function formatDuration(totalMinutes) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes || 0)));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} sa ${m} dk`;
  if (h) return `${h} sa`;
  return `${m} dk`;
}

function formatTimer(ms) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(value => String(value).padStart(2, "0")).join(":");
}

function sessionHourlyRate(item) {
  return Number(item?.hourlyRate ?? state.settings.hourlyRate ?? 0);
}

function sessionIncome(item) {
  return roundMoney(Number(item?.minutes || 0) / 60 * sessionHourlyRate(item));
}

function workIncome(items) {
  return roundMoney(items.reduce((sum, item) => sum + sessionIncome(item), 0));
}

function timeToMinutes(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""))) return NaN;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  const day = 24 * 60;
  const mins = ((Math.round(Number(totalMinutes)) % day) + day) % day;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function isOvernightRange(start, end) {
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  return Number.isFinite(startMin) && Number.isFinite(endMin) && endMin <= startMin;
}

function minutesBetween(start, end) {
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return NaN;
  let diff = endMin - startMin;
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

function formatTimeRange(start, end) {
  if (!start || !end) return "—";
  return isOvernightRange(start, end) ? `${start}–${end} (+1)` : `${start}–${end}`;
}

function sessionSegmentsForDate(item, date) {
  if (!item?.date || !date) return [];
  const startMin = timeToMinutes(item.start);
  const endMin = timeToMinutes(item.end);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return [];
  const overnight = endMin <= startMin;
  if (item.date === date) {
    if (!overnight) return [{ startMin, endMin }];
    return [{ startMin, endMin: 24 * 60 }];
  }
  if (overnight) {
    const nextDate = localDateString(addDays(parseLocalDate(item.date), 1));
    if (nextDate === date) return [{ startMin: 0, endMin }];
  }
  return [];
}

function findWorkConflict({ date, start, end, id = "" }) {
  if (!date || !Number.isFinite(timeToMinutes(start)) || !Number.isFinite(timeToMinutes(end))) return null;
  const candidate = { date, start, end };
  const dates = [date];
  if (isOvernightRange(start, end)) dates.push(localDateString(addDays(parseLocalDate(date), 1)));
  for (const day of dates) {
    const candidateSegs = sessionSegmentsForDate(candidate, day);
    if (!candidateSegs.length) continue;
    const hit = state.workSessions.find(item => {
      if (item.id === id) return false;
      return sessionSegmentsForDate(item, day).some(seg =>
        candidateSegs.some(part => part.startMin < seg.endMin && part.endMin > seg.startMin)
      );
    });
    if (hit) return hit;
  }
  return null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function migrateOldState(old) {
  const migrated = clone(defaultState);
  migrated.settings = { ...migrated.settings, ...(old.settings || {}) };
  migrated.workSessions = (old.workSessions || []).map(item => ({
    ...item,
    customerId: item.customerId || "",
    projectId: item.projectId || "",
    todoId: item.todoId || "",
    breakMinutes: Number(item.breakMinutes || 0),
    createdAt: item.createdAt || Date.now()
  }));
  migrated.todos = (old.todos || []).map(item => ({
    ...item,
    customerId: item.customerId || "",
    projectId: item.projectId || "",
    priority: item.priority || "medium",
    recurrence: item.recurrence || "none",
    status: item.status === "done" ? "done" : "planned",
    createdAt: item.createdAt || Date.now()
  }));
  migrated.sales = (old.sales || []).map(item => ({
    ...item,
    customerId: item.customerId || "",
    projectId: item.projectId || "",
    stage: item.stage || "won",
    paymentStatus: item.paymentStatus || item.status || "pending",
    expectedPaymentDate: item.expectedPaymentDate || "",
    paidAt: item.paidAt || "",
    note: item.note || "",
    createdAt: item.createdAt || Date.now()
  }));
  return migrated;
}

function normalizeState(raw) {
  const normalized = {
    ...clone(defaultState),
    ...(raw || {}),
    settings: { ...defaultState.settings, ...((raw && raw.settings) || {}) }
  };
  for (const key of ["customers", "projects", "workSessions", "todos", "sales", "expenses"]) {
    if (!Array.isArray(normalized[key])) normalized[key] = [];
  }
  normalized.customers = normalized.customers.map(normalizeCustomerNotes);
  normalized.sales = normalized.sales.map(item => {
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(item?.time || ""))) return item;
    const created = Number(item?.createdAt);
    let time = "12:00";
    if (Number.isFinite(created) && created > 0) {
      const stamp = new Date(created);
      if (localDateString(stamp) === item.date) {
        time = `${String(stamp.getHours()).padStart(2, "0")}:${String(stamp.getMinutes()).padStart(2, "0")}`;
      }
    }
    return { ...item, time };
  });
  normalized.version = 2;
  return normalized;
}

function validateImportedState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Yedek veri nesnesi bulunamadı.");
  const data = raw.format === BACKUP_FORMAT ? raw.data : raw;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Yedek içeriği geçersiz.");
  const requiredLists = ["customers", "projects", "workSessions", "todos", "sales", "expenses"];
  for (const key of requiredLists) {
    if (key in data && !Array.isArray(data[key])) throw new Error(`${key} alanı liste olmalı.`);
  }
  if (data.version != null && Number(data.version) > defaultState.version) throw new Error("Bu yedek daha yeni bir uygulama sürümüyle oluşturulmuş.");
  const normalized = normalizeState(data);
  const ids = new Set();
  for (const key of requiredLists) {
    for (const item of normalized[key]) {
      if (!item || typeof item !== "object" || !String(item.id || "").trim()) throw new Error(`${key} içinde kimliği olmayan kayıt var.`);
      if (ids.has(item.id)) throw new Error(`Tekrarlanan kayıt kimliği bulundu: ${item.id}`);
      ids.add(item.id);
    }
  }
  for (const item of normalized.workSessions) {
    const start = timeToMinutes(item.start); const end = timeToMinutes(item.end);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date || "") || !Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`Geçersiz çalışma kaydı: ${item.title || item.id}`);
    }
  }
  return normalized;
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeState(JSON.parse(saved));
    const old = localStorage.getItem(OLD_STORAGE_KEY);
    if (old) {
      const migrated = migrateOldState(JSON.parse(old));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch (error) {
    console.warn("Veriler okunamadı", error);
  }
  return clone(defaultState);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function seedDemoData() {
  if (localStorage.getItem(`${STORAGE_KEY}.seeded`)) return;
  if ([state.customers, state.projects, state.workSessions, state.todos, state.sales, state.expenses].some(items => items.length)) return;

  const now = Date.now();
  const customerA = normalizeCustomerNotes({
    id: uid(), name: "ABC Teknoloji", contact: "Ayşe Demir", email: "", phone: "", demoMeetingDone: true, createdAt: now,
    notes: [
      makeCustomerNote("Tercih: salı günleri demo. Karar verici Ayşe Demir.", now - 86400000),
      makeCustomerNote("Kurumsal paket için bütçe onayı bekleniyor.", now - 3600000)
    ]
  });
  const customerB = normalizeCustomerNotes({
    id: uid(), name: "Nova Danışmanlık", contact: "Mert Kaya", email: "", phone: "", demoMeetingDone: false, createdAt: now,
    notes: [makeCustomerNote("İlk görüşmede danışmanlık paketine sıcak baktılar.", now - 7200000)]
  });
  const projectA = { id: uid(), customerId: customerA.id, name: "Kurumsal Web Sitesi", status: "active", color: "#4f7cff", note: "", createdAt: Date.now() };
  const projectB = { id: uid(), customerId: customerB.id, name: "Satış Danışmanlığı", status: "active", color: "#8b5cf6", note: "", createdAt: Date.now() };
  state.customers = [customerA, customerB];
  state.projects = [projectA, projectB];

  const today = new Date();
  const d0 = localDateString(today);
  const d1 = localDateString(addDays(today, -1));
  const d2 = localDateString(addDays(today, -2));
  const d4 = localDateString(addDays(today, -4));
  const todoA = { id: uid(), title: "Yeni müşteriyi ara", customerId: customerB.id, projectId: projectB.id, date: d0, start: "14:00", end: "14:30", priority: "high", recurrence: "none", note: "", status: "planned", createdAt: Date.now() };
  state.todos = [
    todoA,
    { id: uid(), title: "Haftalık raporu gönder", customerId: customerA.id, projectId: projectA.id, date: d0, start: "16:00", end: "17:00", priority: "medium", recurrence: "weekly", note: "", status: "planned", createdAt: Date.now() },
    { id: uid(), title: "Teklif metnini güncelle", customerId: customerB.id, projectId: projectB.id, date: d1, start: "11:00", end: "12:00", priority: "low", recurrence: "none", note: "", status: "done", createdAt: Date.now() }
  ];
  state.workSessions = [
    makeWork("Teklif ve müşteri görüşmesi", d0, "09:00", "11:30", 0, customerB.id, projectB.id, todoA.id),
    makeWork("Demo toplantısı", d1, "13:00", "17:00", 15, customerA.id, projectA.id, ""),
    makeWork("Raporlama", d2, "10:00", "12:00", 0, customerA.id, projectA.id, ""),
    makeWork("Müşteri hazırlığı", d4, "14:00", "17:30", 15, customerB.id, projectB.id, "")
  ];
  state.sales = [
    makeSale("Kurumsal paket", d0, 25000, 8, customerA.id, projectA.id, "won", "pending", localDateString(addDays(today, 10))),
    makeSale("Danışmanlık paketi", d2, 18000, 10, customerB.id, projectB.id, "won", "paid", d0),
    makeSale("Ek modül teklifi", d1, 12000, 7, customerA.id, projectA.id, "proposal", "pending", "")
  ];
  state.expenses = [{ id: uid(), title: "Tasarım aracı aboneliği", category: "Yazılım", projectId: projectA.id, date: d1, amount: 450, note: "", createdAt: Date.now() }];
  saveState();
  localStorage.setItem(`${STORAGE_KEY}.seeded`, "1");
}

function makeWork(title, date, start, end, breakMinutes, customerId, projectId, todoId = "") {
  const rawMinutes = minutesBetween(start, end);
  const minutes = Math.max(0, rawMinutes - Number(breakMinutes || 0));
  return { id: uid(), title, date, start, end, breakMinutes: Number(breakMinutes || 0), minutes, customerId, projectId, todoId, note: "", createdAt: Date.now() };
}

function makeSale(title, date, amount, commissionRate, customerId, projectId, stage, paymentStatus, expectedPaymentDate, time = "12:00") {
  return { id: uid(), title, date, time, amount, commissionRate, commission: roundMoney(amount * commissionRate / 100), customerId, projectId, stage, paymentStatus, expectedPaymentDate, paidAt: paymentStatus === "paid" ? date : "", note: "", createdAt: Date.now() };
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function customerById(id) {
  return state.customers.find(item => item.id === id);
}

function makeCustomerNote(text, createdAt = Date.now()) {
  const stamp = Number(createdAt) || Date.now();
  return { id: uid(), text: String(text || "").trim(), createdAt: stamp, updatedAt: stamp };
}

function syncCustomerNoteSummary(customer) {
  if (!customer) return customer;
  const notes = Array.isArray(customer.notes) ? customer.notes : [];
  const latest = [...notes].sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0];
  customer.notes = notes;
  customer.note = latest?.text || "";
  return customer;
}

function normalizeCustomerNotes(customer) {
  const base = { ...customer, demoMeetingDone: Boolean(customer?.demoMeetingDone) };
  let notes = Array.isArray(base.notes)
    ? base.notes
      .filter(item => item && typeof item === "object" && String(item.text || "").trim())
      .map(item => ({
        id: String(item.id || uid()),
        text: String(item.text || "").trim(),
        createdAt: Number(item.createdAt) || Date.now(),
        updatedAt: Number(item.updatedAt || item.createdAt) || Date.now()
      }))
    : [];
  const legacy = String(base.note || "").trim();
  if (legacy && !notes.length) notes = [makeCustomerNote(legacy, base.createdAt || Date.now())];
  return syncCustomerNoteSummary({ ...base, notes });
}

function formatDateTime(value) {
  const date = new Date(Number(value) || 0);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("tr-TR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function previewNoteText(text, max = 120) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function projectById(id) {
  return state.projects.find(item => item.id === id);
}

function todoById(id) {
  return state.todos.find(item => item.id === id);
}

function relationText(item) {
  const project = projectById(item.projectId);
  const customer = customerById(item.customerId || project?.customerId);
  return [customer?.name, project?.name].filter(Boolean).join(" • ");
}

function relationLabel(item, empty = "") {
  return relationText(item) || empty;
}

function normalizeDateRange(start, end) {
  const today = localDateString();
  let from = /^\d{4}-\d{2}-\d{2}$/.test(String(start || "")) ? start : today;
  let to = /^\d{4}-\d{2}-\d{2}$/.test(String(end || "")) ? end : today;
  if (from > to) [from, to] = [to, from];
  return { start: from, end: to };
}

function presetPeriodRange(period = selectedPeriod) {
  const today = new Date();
  const end = localDateString(today);
  let start = end;
  if (period === "week") start = localDateString(startOfWeek(today));
  else if (period === "month") start = localDateString(startOfMonth(today));
  return { start, end };
}

function periodRange(period = selectedPeriod) {
  if (period === "custom" && customPeriodRange) return normalizeDateRange(customPeriodRange.start, customPeriodRange.end);
  return presetPeriodRange(period === "custom" ? "day" : period);
}

function syncPeriodDateInputs(range = periodRange()) {
  const startInput = $("#periodStart");
  const endInput = $("#periodEnd");
  if (startInput) startInput.value = range.start;
  if (endInput) endInput.value = range.end;
}

function setPeriodPreset(period) {
  selectedPeriod = period;
  customPeriodRange = null;
  const range = presetPeriodRange(period);
  syncPeriodDateInputs(range);
  $$(".period-tab").forEach(tab => {
    const active = tab.dataset.period === period;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
  });
  const activeTab = $(`.period-tab[data-period="${period}"]`);
  const panel = $("#dashboardPeriodPanel");
  if (panel && activeTab) panel.setAttribute("aria-labelledby", activeTab.id);
}

function setCustomPeriodFromInputs() {
  const range = normalizeDateRange($("#periodStart")?.value, $("#periodEnd")?.value);
  selectedPeriod = "custom";
  customPeriodRange = range;
  syncPeriodDateInputs(range);
  $$(".period-tab").forEach(tab => {
    tab.classList.remove("active");
    tab.setAttribute("aria-selected", "false");
    tab.tabIndex = -1;
  });
  const panel = $("#dashboardPeriodPanel");
  if (panel) panel.setAttribute("aria-labelledby", "");
}

function inPeriod(dateString, period = selectedPeriod) {
  if (!dateString) return false;
  const { start, end } = periodRange(period);
  return dateString >= start && dateString <= end;
}

function periodDays(period = selectedPeriod) {
  const { start, end } = periodRange(period);
  const days = [];
  let cursor = parseLocalDate(start);
  const last = parseLocalDate(end);
  const maxDays = 93;
  while (cursor <= last && days.length < maxDays) {
    days.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  return days;
}

function periodRangeLabel(period = selectedPeriod) {
  const { start, end } = periodRange(period);
  if (start === end) return formatDate(start, { day: "numeric", month: "long", year: "numeric" });
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  if (sameMonth) {
    return `${formatDate(start, { day: "numeric" })}–${formatDate(end, { day: "numeric", month: "long", year: "numeric" })}`;
  }
  return `${formatDate(start, { day: "numeric", month: "short" })} – ${formatDate(end, { day: "numeric", month: "short", year: "numeric" })}`;
}

function periodChartKicker(period = selectedPeriod) {
  if (period === "day") return "Bugün";
  if (period === "week") return "Bu hafta";
  if (period === "month") return "Bu ay";
  return "Seçili dönem";
}

function inMonth(dateString, monthValue) {
  return Boolean(dateString && dateString.slice(0, 7) === monthValue);
}

function inDateRange(dateString, start, end) {
  return Boolean(dateString && start && end && dateString >= start && dateString <= end);
}

function wonSales(records = state.sales) {
  return records.filter(item => item.stage === "won");
}

function selectedMonthValue() {
  return $("#reportMonth")?.value || localDateString().slice(0, 7);
}

function renderAll() {
  populateSelects();
  renderDashboard();
  renderTimer();
  renderCalendar();
  renderMyWork();
  renderTodos();
  renderSales();
  renderCrm();
  renderReports();
  renderSettings();
}

function renderDashboard() {
  const work = state.workSessions.filter(item => inPeriod(item.date, selectedPeriod));
  const salesAll = state.sales.filter(item => inPeriod(item.date, selectedPeriod));
  const sales = wonSales(salesAll);
  const expenses = state.expenses.filter(item => inPeriod(item.date, selectedPeriod));
  const minutes = work.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const salesTotal = sales.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const commission = sales.reduce((sum, item) => sum + Number(item.commission || 0), 0);
  const pending = sales.filter(item => item.paymentStatus !== "paid").reduce((sum, item) => sum + Number(item.commission || 0), 0);
  const paid = sales.filter(item => item.paymentStatus === "paid").reduce((sum, item) => sum + Number(item.commission || 0), 0);
  const expenseTotal = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  setText("#periodRangeLabel", periodRangeLabel(selectedPeriod));
  setText("#statHours", formatDuration(minutes));
  setText("#statHourlyIncome", formatMoney(workIncome(work)));
  setText("#statWorkCount", `${work.length} kayıt`);
  setText("#statSales", formatMoney(salesTotal));
  setText("#statSalesCount", `${sales.length} kazanılan satış`);
  setText("#statCommission", formatMoney(commission));
  setText("#statPendingCommission", `${formatMoney(pending)} bekliyor`);
  setText("#statExpense", formatMoney(expenseTotal));
  setText("#statTotalIncome", formatMoney(paid));

  const monthCommission = wonSales(state.sales.filter(item => inPeriod(item.date, "month"))).reduce((sum, item) => sum + Number(item.commission || 0), 0);
  setText("#sidebarMonthlyIncome", formatMoney(monthCommission));

  renderPeriodChart();
  renderTodayTodos();
  renderGoals();
  renderInsights();
  renderRecentActivity();
}

function renderPeriodChart() {
  const root = $("#weeklyChart");
  if (!root) return;
  const days = periodDays(selectedPeriod);
  const values = days.map(date => {
    const dateKey = localDateString(date);
    const sessions = state.workSessions.filter(item => item.date === dateKey);
    return { date, dateKey, minutes: sessions.reduce((sum, item) => sum + Number(item.minutes || 0), 0) };
  });
  const maxMinutes = Math.max(...values.map(item => item.minutes), 60);
  const useDayNumber = selectedPeriod === "month" || values.length > 7;
  root.innerHTML = values.map(item => {
    const height = Math.max(4, Math.round(item.minutes / maxMinutes * 100));
    const label = useDayNumber
      ? String(item.date.getDate())
      : item.date.toLocaleDateString("tr-TR", { weekday: "short" }).replace(".", "");
    const tip = `${formatDate(item.dateKey, { day: "numeric", month: "short" })} · ${formatDuration(item.minutes)}`;
    return `<div class="chart-day"><div class="chart-bar-wrap"><div class="chart-bar" style="height:${height}%" data-tip="${escapeHtml(tip)}"></div></div><div class="chart-label">${escapeHtml(label)}</div></div>`;
  }).join("");
  setText("#workChartKicker", periodChartKicker(selectedPeriod));
  setText("#weeklyChartTotal", `${formatDuration(values.reduce((sum, item) => sum + item.minutes, 0))} toplam`);
}

function renderTodayTodos() {
  const today = localDateString();
  const items = state.todos.filter(item => item.date === today && item.status !== "done").sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5);
  $("#todayTodos").innerHTML = items.length ? items.map(item => `<div class="compact-item"><span class="compact-time">${escapeHtml(item.start)}</span><div class="compact-item-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml([relationText(item), statusLabel(item.status)].filter(Boolean).join(" • "))}</small></div><button class="todo-complete-btn compact" data-complete-todo="${item.id}" title="İşi tamamla" aria-label="${escapeHtml(item.title)} görevini tamamla">✓</button></div>`).join("") : `<div class="empty-state">Bugün için bekleyen todo yok.</div>`;
}

function renderGoals() {
  const monthWork = state.workSessions.filter(item => inPeriod(item.date, "month"));
  const monthSales = wonSales(state.sales.filter(item => inPeriod(item.date, "month")));
  const sales = monthSales.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const commission = monthSales.reduce((sum, item) => sum + Number(item.commission || 0), 0);
  const minutes = monthWork.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const now = new Date();
  const elapsedDays = now.getDate();
  const workTargetMinutes = Number(state.settings.dailyWorkTargetHours || 0) * elapsedDays * 60;
  setGoal("#goalProgress", "#salesGoalPercent", "#goalText", sales, Number(state.settings.monthlySalesTarget || 0), formatMoney);
  setGoal("#incomeGoalProgress", "#incomeGoalPercent", "#incomeGoalText", commission, Number(state.settings.monthlyIncomeTarget || 0), formatMoney);
  setGoal("#workGoalProgress", "#workGoalPercent", "#workGoalText", minutes, workTargetMinutes, formatDuration);
}

function setGoal(barSelector, percentSelector, textSelector, value, target, formatter) {
  const percent = target > 0 ? Math.min(100, value / target * 100) : 0;
  $(barSelector).style.width = `${percent}%`;
  setText(percentSelector, `%${Math.round(percent)}`);
  setText(textSelector, target > 0 ? `${formatter(value)} / ${formatter(target)} • ${formatter(Math.max(0, target - value))} kaldı` : "Hedef ayarlanmamış.");
}

function renderInsights() {
  const root = $("#insightList");
  const monthWork = state.workSessions.filter(item => inPeriod(item.date, "month"));
  const monthSales = wonSales(state.sales.filter(item => inPeriod(item.date, "month")));
  const insights = [];
  if (monthWork.length) {
    const byDay = new Map();
    monthWork.forEach(item => byDay.set(item.date, (byDay.get(item.date) || 0) + Number(item.minutes || 0)));
    const best = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
    insights.push(`En yoğun günün ${formatDate(best[0], { day: "numeric", month: "long" })}: ${formatDuration(best[1])} çalıştın.`);
  }
  if (monthSales.length) {
    const top = [...monthSales].sort((a, b) => Number(b.commission) - Number(a.commission))[0];
    insights.push(`En yüksek prim ${escapeHtml(top.title)} satışından geldi: ${formatMoney(top.commission)}.`);
  }
  const overdue = monthSales.filter(item => item.paymentStatus !== "paid" && item.expectedPaymentDate && parseLocalDate(item.expectedPaymentDate) < parseLocalDate(localDateString()));
  if (overdue.length) insights.push(`${overdue.length} prim ödemesinin beklenen tarihi geçti.`);
  const planned = state.todos.filter(item => inPeriod(item.date, "month"));
  if (planned.length) {
    const done = planned.filter(item => item.status === "done").length;
    insights.push(`Bu ay todo tamamlama oranın %${Math.round(done / planned.length * 100)}.`);
  }
  if (!insights.length) insights.push("Analiz üretmek için çalışma, todo veya satış kaydı ekleyin.");
  root.innerHTML = insights.slice(0, 4).map((text, index) => `<div class="insight-item"><div class="insight-icon">${index + 1}</div><p>${text}</p></div>`).join("");
}

function renderRecentActivity() {
  const rows = [
    ...state.workSessions.filter(item => inPeriod(item.date, selectedPeriod)).map(item => ({ type: "work", title: item.title, relation: relationText(item), date: item.date, value: formatDuration(item.minutes), tone: "" })),
    ...wonSales().filter(item => inPeriod(item.date, selectedPeriod)).map(item => ({ type: "sale", title: item.title, relation: relationText(item), date: item.date, value: formatMoney(item.amount), tone: "amount-positive" })),
    ...state.expenses.filter(item => inPeriod(item.date, selectedPeriod)).map(item => ({ type: "expense", title: item.title, relation: relationText(item), date: item.date, value: `−${formatMoney(item.amount)}`, tone: "amount-negative" }))
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  $("#recentActivity").innerHTML = rows.length ? rows.map(item => `<tr><td><span class="badge badge-${item.type}">${item.type === "work" ? "Çalışma" : item.type === "sale" ? "Satış" : "Gider"}</span></td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.relation || "—")}</td><td>${formatDate(item.date)}</td><td class="${item.tone}">${escapeHtml(item.value)}</td></tr>`).join("") : `<tr><td colspan="5" class="empty-state">Bu dönemde hareket yok.</td></tr>`;
}

function timerElapsedMs() {
  const timer = state.timer;
  if (!timer) return 0;
  const base = Number(timer.accumulatedMs || 0);
  if (!timer.running || timer.paused) return base;
  return base + (Date.now() - Number(timer.segmentStartedAt || Date.now()));
}

function renderTimer() {
  const timer = state.timer;
  const running = Boolean(timer?.running);
  const paused = Boolean(timer?.paused);
  const display = formatTimer(timerElapsedMs());
  setText("#dashboardTimerDisplay", display);
  setText("#timerPillText", running ? display : "Sayaç başlat");
  $("#timerPill")?.classList.toggle("running", running && !paused);
  $("#dashboardTimerCard")?.classList.toggle("running", running);
  $("#dashboardTimerState")?.classList.toggle("running", running && !paused);
  setText("#dashboardTimerState", !running ? "Hazır" : paused ? "Duraklatıldı" : "Çalışıyor");
  setText("#dashboardTimerTitle", running ? timer.title : "Sayaç hazır");
  setText(
    "#dashboardTimerMeta",
    running
      ? `Başlangıç: ${localTimeString(new Date(Number(timer.sessionStartedAt)))} • Bitirdikten sonra ayrıntıları düzenleyebilirsiniz.`
      : "Tek tıkla şimdi başlayın; ayrıntıları çalışma bittikten sonra ekleyebilirsiniz."
  );
  const main = $("#dashboardTimerMain");
  const stop = $("#dashboardTimerStop");
  if (running) {
    main.textContent = paused ? "Devam Et" : "Duraklat";
    main.removeAttribute("data-open-timer");
    main.dataset.timerToggle = "1";
    stop.classList.remove("hidden");
  } else {
    main.textContent = "Çalışmaya Başla";
    main.setAttribute("data-open-timer", "");
    delete main.dataset.timerToggle;
    stop.classList.add("hidden");
  }
  clearInterval(timerInterval);
  if (running && !paused) timerInterval = setInterval(renderTimer, 1000);
}

function startTimer(data = {}) {
  if (state.timer?.running) return toast("Önce mevcut sayacı bitirin.");
  const project = projectById(data.projectId);
  const startedAt = Date.now();
  state.timer = {
    running: true,
    paused: false,
    title: (data.title || "İsimsiz çalışma").trim(),
    customerId: data.customerId || project?.customerId || "",
    projectId: data.projectId || "",
    todoId: data.todoId || "",
    note: (data.note || "").trim(),
    sessionStartedAt: startedAt,
    segmentStartedAt: startedAt,
    accumulatedMs: 0
  };
  const todo = todoById(state.timer.todoId);
  if (todo && todo.status === "planned") todo.status = "progress";
  rememberFormChoices(data); saveState(); closeModal(); renderAll();
  toast(`Sayaç ${localTimeString(new Date(startedAt))} itibarıyla başladı.`);
}

function toggleTimer() {
  if (!state.timer?.running) return startTimer();
  if (state.timer.paused) {
    state.timer.paused = false;
    state.timer.segmentStartedAt = Date.now();
  } else {
    state.timer.accumulatedMs = timerElapsedMs();
    state.timer.paused = true;
  }
  saveState(); renderTimer();
}

function stopTimer() {
  const timer = state.timer;
  if (!timer?.running) return;
  const elapsed = timerElapsedMs();
  if (elapsed < 15000 && !confirm("Sayaç 15 saniyeden kısa çalıştı. Yine de kaydedilsin mi?")) return;
  const started = new Date(Number(timer.sessionStartedAt || Date.now() - elapsed));
  const ended = new Date();
  const date = localDateString(started);
  let start = localTimeString(started);
  let end = localTimeString(ended);
  if (start === end) {
    end = localTimeString(new Date(started.getTime() + Math.max(elapsed, 60000)));
    if (start === end) end = localTimeString(new Date(started.getTime() + 60000));
  }
  const minutes = Math.max(1, Math.round(elapsed / 60000) || 1);
  const conflict = findWorkConflict({ date, start, end });
  if (conflict) return toast(`Bu zaman aralığı “${conflict.title}” kaydıyla çakışıyor. Çalışmalarım’dan çakışan kaydı düzenleyip tekrar deneyin.`);
  const savedItem = {
    id: uid(), title: timer.title || "İsimsiz çalışma", customerId: timer.customerId || "", projectId: timer.projectId || "", todoId: timer.todoId || "",
    date, start, end, breakMinutes: 0,
    minutes, hourlyRate: Number(state.settings.hourlyRate || 0), note: timer.note || "", createdAt: Date.now(), source: "timer"
  };
  state.workSessions.push(savedItem);
  state.timer = null;
  if ($("#myWorkDate")) $("#myWorkDate").value = date;
  saveState(); renderAll();
  toast(isOvernightRange(start, end)
    ? "Sayaç Çalışmalarım’a kaydedildi (ertesi güne sarkıyor)."
    : "Sayaç Çalışmalarım’a kaydedildi.");
}

function renderWeekStrip(selectedDate) {
  const root = $("#weekStrip");
  if (!root) return;
  const weekStart = startOfWeek(parseLocalDate(selectedDate));
  const today = localDateString();
  const dayNames = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  root.innerHTML = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(weekStart, index);
    const value = localDateString(day);
    const workMinutes = state.workSessions.filter(item => item.date === value).reduce((sum, item) => sum + Number(item.minutes || 0), 0);
    const todoCount = state.todos.filter(item => item.date === value).length;
    const saleCount = state.sales.filter(item => item.date === value).length;
    const intensity = Math.min(1, workMinutes / Math.max(60, Number(state.settings.dailyWorkTargetHours || 6) * 60));
    const classes = ["week-day", value === selectedDate ? "active" : "", value === today ? "is-today" : ""].filter(Boolean).join(" ");
    return `<button type="button" class="${classes}" data-calendar-day="${value}" role="tab" aria-selected="${value === selectedDate}">
      <span class="week-day-name">${dayNames[index]}</span>
      <strong>${day.getDate()}</strong>
      <span class="week-day-meta">${workMinutes ? formatDuration(workMinutes) : "—"}${todoCount ? ` · ${todoCount} todo` : ""}</span>
      <span class="week-day-dots">${saleCount ? `<i class="dot sale" title="${saleCount} satış"></i>` : ""}${todoCount ? `<i class="dot todo" title="${todoCount} todo"></i>` : ""}${workMinutes ? `<i class="dot work" title="${formatDuration(workMinutes)}"></i>` : ""}</span>
      <span class="week-day-bar" style="--intensity:${intensity}"></span>
    </button>`;
  }).join("");
}

function saleDayMinutes(item) {
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(item?.time || ""))) return timeToMinutes(item.time);
  const created = Number(item?.createdAt);
  if (Number.isFinite(created) && created > 0) {
    const stamp = new Date(created);
    if (localDateString(stamp) === item.date) return stamp.getHours() * 60 + stamp.getMinutes();
  }
  return 12 * 60;
}

function renderCalEventCard(event) {
  const deleteBtn = `<button type="button" class="icon-btn" data-delete="${event.kind}" data-id="${event.id}" title="Sil">Sil</button>`;
  let actions = `<button type="button" class="icon-btn" data-edit="${event.kind}" data-id="${event.id}">Düzenle</button>${deleteBtn}`;
  if (event.kind === "todo") {
    actions = `${event.status !== "done" ? `<button type="button" class="todo-complete-btn compact" data-complete-todo="${event.id}" title="İşi tamamla">✓</button><button type="button" class="icon-btn" data-start-todo="${event.id}" title="Sayaç başlat">▶</button>` : `<button type="button" class="icon-btn" data-reopen-todo="${event.id}" title="Tekrar aç">Geri al</button>`}<button type="button" class="icon-btn" data-edit="todo" data-id="${event.id}">Düzenle</button>${deleteBtn}`;
  }
  const kindBadge = event.kind === "sale"
    ? "Satış"
    : event.kind === "todo"
      ? (event.status === "done" ? "Todo · Tamamlandı" : "Todo")
      : "Çalışma";
  const meta = event.kind === "work"
    ? `${formatDuration(Math.max(1, event.endMin - event.startMin))}${event.income != null ? ` · ${formatMoney(event.income)}` : ""}${event.segmentNote || ""}`
    : event.kind === "sale"
      ? `${formatMoney(event.amount)} · Prim ${formatMoney(event.commission)} · ${stageLabel(event.status)}`
      : `${statusLabel(event.status)} · ${priorityLabel(event.priority)}${event.segmentNote || ""}`;
  const timeEnd = event.kind === "sale" ? "satış" : minutesToTime(event.endMin);
  return `<article class="cal-item">
    <div class="cal-item-time">${minutesToTime(event.startMin)}<small>${timeEnd}</small></div>
    <div class="cal-item-card ${event.kind}${event.status === "done" ? " is-done" : ""}">
      <div class="cal-item-copy">
        <span class="cal-item-kind">${kindBadge}</span>
        <strong>${escapeHtml(event.title)}</strong>
        <span>${escapeHtml(meta)}</span>
        ${event.relation ? `<span>${escapeHtml(event.relation)}</span>` : ""}
        ${event.note ? `<em>${escapeHtml(event.note)}</em>` : ""}
      </div>
      <div class="cal-item-actions">${actions}</div>
    </div>
  </article>`;
}

function renderDayProgram(events) {
  if (!events.length) {
    return `<div class="cal-empty">
      <strong>Bu gün henüz boş</strong>
      <p>Sabah / öğle / akşam kısayoluyla veya alttaki butonlarla kayıt ekleyebilirsiniz.</p>
      <button type="button" class="primary-btn" data-cal-preset="morning">Sabah planla</button>
    </div>`;
  }
  const parts = [];
  let cursor = null;
  for (const event of events) {
    if (cursor != null && event.startMin - cursor >= 30) {
      const gapStart = minutesToTime(cursor);
      const gapEnd = minutesToTime(event.startMin);
      const gapHour = Math.floor(cursor / 60);
      parts.push(`<button type="button" class="cal-gap" data-calendar-slot="${gapHour}" title="${gapStart}–${gapEnd} arası ekle"><span>${gapStart}–${gapEnd} boş</span><span>+ Ekle</span></button>`);
    }
    parts.push(renderCalEventCard(event));
    cursor = event.endMin;
  }
  return parts.join("");
}

function renderCalendar() {
  const date = $("#calendarDate")?.value || localDateString();
  const prevDate = localDateString(addDays(parseLocalDate(date), -1));
  const work = state.workSessions.filter(item => item.date === date);
  const todos = state.todos.filter(item => item.date === date);
  const timelineWork = state.workSessions.filter(item => item.date === date || (item.date === prevDate && isOvernightRange(item.start, item.end)));
  const timelineTodos = state.todos.filter(item => item.date === date || (item.date === prevDate && isOvernightRange(item.start, item.end)));
  const daySales = state.sales.filter(item => item.date === date);
  const won = wonSales(daySales);
  const minutes = work.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const income = workIncome(work);
  const commission = won.reduce((sum, item) => sum + Number(item.commission || 0), 0);
  const doneTodos = todos.filter(item => item.status === "done").length;
  const targetMinutes = Number(state.settings.dailyWorkTargetHours || 0) * 60;
  const goalPercent = targetMinutes ? Math.min(100, Math.round(minutes / targetMinutes * 100)) : 0;
  const dateObj = parseLocalDate(date);

  setText("#calWeekday", dateObj.toLocaleDateString("tr-TR", { weekday: "long" }));
  setText("#calDateTitle", dateObj.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }));
  renderWeekStrip(date);

  const summary = $("#daySummary");
  if (summary) {
    summary.innerHTML = [
      ["Çalışma", formatDuration(minutes)],
      ["Kazanç", formatMoney(income)],
      ["Todo", `${doneTodos}/${todos.length}`],
      ["Satış", `${daySales.length}`],
      ["Prim", formatMoney(commission)]
    ].map(([label, value]) => `<div class="cal-chip"><span>${label}</span><strong>${value}</strong></div>`).join("");
  }

  const goalRoot = $("#dayGoal");
  if (goalRoot) {
    goalRoot.innerHTML = targetMinutes
      ? `<div class="day-goal-copy"><span>Günlük hedef</span><strong>%${goalPercent}</strong></div><div class="progress"><span style="width:${goalPercent}%"></span></div><small>${formatDuration(minutes)} / ${formatDuration(targetMinutes)}</small>`
      : `<div class="day-goal-copy"><span>Günlük hedef</span><strong>—</strong></div><small>Ayarlar’dan günlük hedef belirleyebilirsiniz.</small>`;
  }

  const events = [];
  for (const { item, kind } of [
    ...timelineWork.map(item => ({ item, kind: "work" })),
    ...timelineTodos.map(item => ({ item, kind: "todo" }))
  ]) {
    for (const segment of sessionSegmentsForDate(item, date)) {
      if (!Number.isFinite(segment.startMin) || !Number.isFinite(segment.endMin) || segment.endMin <= segment.startMin) continue;
      const overnight = isOvernightRange(item.start, item.end);
      const isContinuation = overnight && item.date !== date;
      const isLeadIn = overnight && item.date === date && segment.endMin === 24 * 60;
      events.push({
        kind,
        id: item.id,
        title: item.title,
        minutes: item.minutes,
        income: kind === "work" ? sessionIncome(item) : undefined,
        status: item.status,
        priority: item.priority,
        relation: relationLabel(item),
        note: item.note || "",
        segmentNote: isContinuation ? " · geceden" : isLeadIn ? " · +1 gün" : "",
        startMin: segment.startMin,
        endMin: segment.endMin
      });
    }
  }
  for (const item of daySales) {
    const startMin = Math.min(23 * 60 + 30, Math.max(0, saleDayMinutes(item)));
    events.push({
      kind: "sale",
      id: item.id,
      title: item.title,
      amount: item.amount,
      commission: item.commission,
      status: item.stage,
      relation: relationLabel(item),
      note: item.note || "",
      segmentNote: "",
      startMin,
      endMin: Math.min(24 * 60, startMin + 30)
    });
  }
  events.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.title.localeCompare(b.title, "tr"));

  const agenda = $("#dayAgenda");
  const agendaMeta = $("#dayAgendaMeta");
  if (agendaMeta) agendaMeta.textContent = events.length ? `${events.length} kayıt` : "Boş gün";
  if (agenda) agenda.innerHTML = renderDayProgram(events);

  const salesRoot = $("#daySales");
  const salesCount = $("#daySalesCount");
  if (salesCount) salesCount.textContent = daySales.length ? `${daySales.length} kayıt` : "Yok";
  if (salesRoot) {
    salesRoot.innerHTML = daySales.length
      ? daySales.map(item => `<div class="day-sale-item">
          <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml([stageLabel(item.stage), relationText(item)].filter(Boolean).join(" · "))}</small></div>
          <div class="day-sale-values"><strong>${formatMoney(item.amount)}</strong><small>Prim ${formatMoney(item.commission)}</small></div>
          <div class="row-actions"><button type="button" class="icon-btn" data-edit="sale" data-id="${item.id}">Düzenle</button><button type="button" class="icon-btn" data-delete="sale" data-id="${item.id}">Sil</button></div>
        </div>`).join("")
      : `<div class="empty-state">Satış yok.</div>`;
  }
}

function openCalendarSlot(hour) {
  const start = `${String(hour).padStart(2, "0")}:00`;
  const endHour = Math.min(hour + 1, 23);
  const end = `${String(endHour).padStart(2, "0")}:00`;
  pendingSlotTime = { start, end, date: $("#calendarDate")?.value || localDateString() };
  openModal(null, { preserveSlot: true });
}

function openCalendarPreset(preset) {
  const ranges = {
    morning: ["09:00", "10:00"],
    midday: ["12:00", "13:00"],
    afternoon: ["15:00", "16:00"],
    evening: ["19:00", "20:00"]
  };
  const [start, end] = ranges[preset] || ranges.morning;
  pendingSlotTime = { start, end, date: $("#calendarDate")?.value || localDateString() };
  openModal(null, { preserveSlot: true });
}

function renderTodos() {
  const status = $("#todoStatusFilter")?.value || "all";
  const priority = $("#todoPriorityFilter")?.value || "all";
  const project = $("#todoProjectFilter")?.value || "all";
  const date = $("#todoDateFilter")?.value || "";
  const rows = [...state.todos].filter(item => (status === "all" || item.status === status) && (priority === "all" || item.priority === priority) && (project === "all" || item.projectId === project) && (!date || item.date === date)).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  $("#todoTable").innerHTML = rows.length ? rows.map(item => `<tr>
    <td><span class="badge badge-${item.status}">${statusLabel(item.status)}</span></td>
    <td><span class="priority-dot ${item.priority}"></span>${priorityLabel(item.priority)}</td>
    <td><strong>${escapeHtml(item.title)}</strong>${item.note ? `<br><small>${escapeHtml(item.note)}</small>` : ""}</td>
    <td>${escapeHtml(projectById(item.projectId)?.name || "Genel")}</td><td>${formatDate(item.date, { day: "numeric", month: "short", year: "numeric" })}</td><td>${formatTimeRange(item.start, item.end)}</td><td>${recurrenceLabel(item.recurrence)}</td>
    <td><div class="row-actions">${item.status === "done" ? `<button class="icon-btn" data-reopen-todo="${item.id}" title="Tekrar aç">Geri al</button>` : `<button class="todo-complete-btn" data-complete-todo="${item.id}" title="İşi tamamla">✓ Tamamla</button><button class="icon-btn" data-start-todo="${item.id}" title="Sayaç başlat">▶</button>`}<button class="icon-btn" data-edit="todo" data-id="${item.id}" title="Düzenle">Düzenle</button><button class="icon-btn" data-delete="todo" data-id="${item.id}" title="Sil">Sil</button></div></td>
  </tr>`).join("") : `<tr><td colspan="8" class="empty-state">Filtreye uygun todo bulunamadı.</td></tr>`;
}

function renderMyWork() {
  const root = $("#myWorkList");
  if (!root) return;
  const date = $("#myWorkDate")?.value || localDateString();
  const work = state.workSessions.filter(item => item.date === date);
  const todos = state.todos.filter(item => item.date === date);
  const sales = state.sales.filter(item => item.date === date);
  const minutes = work.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const done = todos.filter(item => item.status === "done").length;
  const activities = [
    ...work.map(item => ({ type: "work", id: item.id, time: item.start, end: item.end, title: item.title, detail: [formatDuration(item.minutes), item.source === "timer" ? "Sayaç" : "", relationText(item)].filter(Boolean).join(" • "), note: item.note, label: item.source === "timer" ? "Sayaç" : "Çalışma", source: item.source || "" })),
    ...todos.map(item => ({ type: "todo", id: item.id, time: item.start, end: item.end, title: item.title, detail: [statusLabel(item.status), relationText(item)].filter(Boolean).join(" • "), note: item.note, label: "Todo", done: item.status === "done" })),
    ...sales.map(item => ({ type: "sale", id: item.id, time: item.time || "12:00", end: "", title: item.title, detail: [stageLabel(item.stage), formatMoney(item.amount), relationText(item)].filter(Boolean).join(" • "), note: item.note, label: "Satış" }))
  ].sort((a, b) => `${a.time}${a.type}`.localeCompare(`${b.time}${b.type}`));

  $("#myWorkSummary").innerHTML = `<div><span>Toplam çalışma</span><strong>${formatDuration(minutes)}</strong></div><div><span>Çalışma kazancı</span><strong>${formatMoney(workIncome(work))}</strong></div><div><span>Çalışma kaydı</span><strong>${work.length}</strong></div><div><span>Tamamlanan todo</span><strong>${done}/${todos.length}</strong></div><div><span>Satış kaydı</span><strong>${sales.length}</strong></div>`;
  setText("#myWorkHeading", date === localDateString() ? "Bugünün çalışmaları" : `${formatDate(date, { day: "numeric", month: "long", year: "numeric" })} kayıtları`);
  setText("#myWorkCount", `${activities.length} kayıt`);
  root.innerHTML = activities.length ? activities.map(item => `<div class="mywork-item ${item.done ? "is-done" : ""} ${item.source === "timer" ? "from-timer" : ""}">
    <div class="mywork-time"><strong>${item.type === "sale" ? "Gün içi" : escapeHtml(item.time)}</strong><span>${item.end ? escapeHtml(item.end) : ""}</span></div>
    <span class="badge badge-${item.type}${item.source === "timer" ? " badge-timer" : ""}">${item.label}</span>
    <div class="mywork-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span>${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}</div>
    <div class="row-actions">${item.type === "todo" && !item.done ? `<button class="todo-complete-btn" data-complete-todo="${item.id}">✓ Tamamla</button>` : ""}<button class="icon-btn" data-edit="${item.type}" data-id="${item.id}">Düzenle</button><button class="icon-btn" data-delete="${item.type}" data-id="${item.id}">Sil</button></div>
  </div>`).join("") : `<div class="empty-state mywork-empty"><strong>Bu gün için henüz kayıt yok.</strong><span>Kodlama veya diğer işlerinizi müşteri seçmeden de ekleyebilirsiniz.</span><div><button class="primary-btn" data-open-modal="work">+ Çalışma ekle</button></div></div>`;
}

function renderSales() {
  const stage = $("#saleStageFilter")?.value || "all";
  const payment = $("#salePaymentFilter")?.value || "all";
  const customer = $("#saleCustomerFilter")?.value || "all";
  const rows = [...state.sales].filter(item => (stage === "all" || item.stage === stage) && (payment === "all" || item.paymentStatus === payment) && (customer === "all" || item.customerId === customer)).sort((a, b) => b.date.localeCompare(a.date));
  $("#salesTable").innerHTML = rows.length ? rows.map(item => {
    const overdue = item.stage === "won" && item.paymentStatus !== "paid" && item.expectedPaymentDate && parseLocalDate(item.expectedPaymentDate) < parseLocalDate(localDateString());
    return `<tr><td><strong>${escapeHtml(item.title)}</strong>${item.note ? `<br><small>${escapeHtml(item.note)}</small>` : ""}</td><td>${escapeHtml(customerById(item.customerId)?.name || "—")}</td><td>${formatDate(item.date, { day: "numeric", month: "short", year: "numeric" })}</td><td><span class="badge badge-${item.stage}">${stageLabel(item.stage)}</span></td><td>${formatMoney(item.amount)}</td><td><strong>${formatMoney(item.commission)}</strong><br><small>%${item.commissionRate}</small></td><td><span class="badge badge-${item.paymentStatus}">${paymentLabel(item.paymentStatus)}</span><br><small class="${overdue ? "amount-negative" : ""}">${item.paymentStatus === "paid" ? formatDate(item.paidAt || item.date) : item.expectedPaymentDate ? `Beklenen: ${formatDate(item.expectedPaymentDate)}` : "Tarih yok"}</small></td><td><div class="row-actions"><button class="icon-btn" data-edit="sale" data-id="${item.id}">Düzenle</button><button class="icon-btn" data-delete="sale" data-id="${item.id}">Sil</button></div></td></tr>`;
  }).join("") : `<tr><td colspan="8" class="empty-state">Satış kaydı bulunamadı.</td></tr>`;

  const monthlyWon = wonSales(state.sales.filter(item => inPeriod(item.date, "month")));
  setText("#salesMonthTotal", formatMoney(monthlyWon.reduce((sum, item) => sum + Number(item.amount || 0), 0)));
  setText("#salesMonthCommission", formatMoney(monthlyWon.reduce((sum, item) => sum + Number(item.commission || 0), 0)));
  setText("#salesPendingCommission", formatMoney(monthlyWon.filter(item => item.paymentStatus !== "paid").reduce((sum, item) => sum + Number(item.commission || 0), 0)));

  const stages = ["lead", "contacted", "proposal", "won", "lost"];
  $("#pipelineGrid").innerHTML = stages.map(value => {
    const items = state.sales.filter(item => item.stage === value);
    const amount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return `<div class="pipeline-card"><span>${stageLabel(value)}</span><strong>${items.length}</strong><small>${formatMoney(amount)}</small></div>`;
  }).join("");
}

function renderCrm() {
  setText("#customerCount", state.customers.length);
  setText("#projectCount", state.projects.length);
  $("#customerList").innerHTML = state.customers.length ? state.customers.map(customer => {
    const projects = state.projects.filter(project => project.customerId === customer.id);
    const sales = wonSales(state.sales.filter(item => item.customerId === customer.id));
    const demoDone = Boolean(customer.demoMeetingDone);
    const notes = Array.isArray(customer.notes) ? customer.notes : [];
    const latest = [...notes].sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0];
    const preview = previewNoteText(latest?.text || customer.note || "");
    return `<div class="entity-card">
      <div class="entity-card-head"><div><h3>${escapeHtml(customer.name)}</h3><p>${escapeHtml(customer.contact || "Yetkili bilgisi yok")}</p></div>
      <div class="row-actions"><button class="icon-btn" data-open-notes="${customer.id}">Notlar${notes.length ? ` (${notes.length})` : ""}</button><button class="icon-btn" data-edit="customer" data-id="${customer.id}">Düzenle</button><button class="icon-btn" data-delete="customer" data-id="${customer.id}">Sil</button></div></div>
      ${preview ? `<p class="entity-note">${escapeHtml(preview)}</p>` : `<button type="button" class="entity-note-add" data-open-notes="${customer.id}">+ Not ekle</button>`}
      <div class="entity-metrics"><div><span>Projeler</span><strong>${projects.length}</strong></div><button type="button" class="demo-check${demoDone ? " is-done" : ""}" data-toggle-demo="${customer.id}" title="Demo toplantısı kontrolü" aria-pressed="${demoDone}"><span>Demo toplantısı</span><strong>${demoDone ? "Yapıldı" : "Bekliyor"}</strong></button><div><span>Satış</span><strong>${formatMoney(sales.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</strong></div></div>
    </div>`;
  }).join("") : `<div class="empty-state">Henüz müşteri eklenmedi.</div>`;

  $("#projectList").innerHTML = state.projects.length ? state.projects.map(project => {
    const customer = customerById(project.customerId);
    const work = state.workSessions.filter(item => item.projectId === project.id);
    const sales = wonSales(state.sales.filter(item => item.projectId === project.id));
    return `<div class="entity-card"><div class="entity-card-head"><div><h3><span class="color-dot" style="background:${escapeHtml(project.color || "#4f7cff")}"></span> ${escapeHtml(project.name)}</h3><p>${escapeHtml(customer?.name || "Müşteri yok")}</p></div><div class="row-actions"><span class="badge badge-${project.status}">${projectStatusLabel(project.status)}</span><button class="icon-btn" data-edit="project" data-id="${project.id}">Düzenle</button><button class="icon-btn" data-delete="project" data-id="${project.id}">Sil</button></div></div><div class="entity-metrics"><div><span>Süre</span><strong>${formatDuration(work.reduce((sum, item) => sum + Number(item.minutes || 0), 0))}</strong></div><div><span>Çalışma kaydı</span><strong>${work.length}</strong></div><div><span>Satış</span><strong>${formatMoney(sales.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</strong></div></div></div>`;
  }).join("") : `<div class="empty-state">Henüz proje eklenmedi.</div>`;
}

function renderReports() {
  const month = selectedMonthValue();
  const work = state.workSessions.filter(item => inMonth(item.date, month));
  const sales = wonSales(state.sales.filter(item => inMonth(item.date, month)));
  const minutes = work.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const salesTotal = sales.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const commission = sales.reduce((sum, item) => sum + Number(item.commission || 0), 0);
  const paid = sales.filter(item => item.paymentStatus === "paid").reduce((sum, item) => sum + Number(item.commission || 0), 0);
  setText("#reportHours", `${formatDuration(minutes)} • ${work.length} kayıt`); setText("#reportWorkIncome", formatMoney(workIncome(work)));
  setText("#reportSales", formatMoney(salesTotal)); setText("#reportSalesCount", `${sales.length} satış`);
  setText("#reportCommission", formatMoney(commission)); setText("#reportPaidCommission", `${formatMoney(paid)} ödendi`);

  const projectIds = new Set([...work.map(item => item.projectId), ...sales.map(item => item.projectId)].filter(Boolean));
  const projectRows = [...projectIds].map(projectId => {
    const project = projectById(projectId);
    const projectWork = work.filter(item => item.projectId === projectId);
    const projectSales = sales.filter(item => item.projectId === projectId);
    return { project, minutes: projectWork.reduce((sum, item) => sum + Number(item.minutes || 0), 0), workCount: projectWork.length, sales: projectSales.reduce((sum, item) => sum + Number(item.amount || 0), 0), commission: projectSales.reduce((sum, item) => sum + Number(item.commission || 0), 0) };
  }).sort((a, b) => (b.sales + b.commission) - (a.sales + a.commission));
  $("#projectReportTable").innerHTML = projectRows.length ? projectRows.map(row => `<tr><td><strong>${escapeHtml(row.project?.name || "Silinmiş proje")}</strong></td><td>${escapeHtml(customerById(row.project?.customerId)?.name || "—")}</td><td>${formatDuration(row.minutes)}</td><td>${row.workCount}</td><td>${formatMoney(row.sales)}</td><td>${formatMoney(row.commission)}</td></tr>`).join("") : `<tr><td colspan="6" class="empty-state">Bu ay proje verisi yok.</td></tr>`;

  const todos = state.todos.filter(item => inMonth(item.date, month));
  const estimated = todos.reduce((sum, item) => sum + Math.max(0, minutesBetween(item.start, item.end)), 0);
  const linkedActual = work.filter(item => item.todoId).reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const completion = todos.length ? Math.round(todos.filter(item => item.status === "done").length / todos.length * 100) : 0;
  $("#planningReport").innerHTML = `<div class="metric-item"><span>Planlanan süre</span><strong>${formatDuration(estimated)}</strong></div><div class="metric-item"><span>Todo’ya bağlı gerçek süre</span><strong>${formatDuration(linkedActual)}</strong></div><div class="metric-item"><span>Süre farkı</span><strong>${linkedActual >= estimated ? "+" : "−"}${formatDuration(Math.abs(linkedActual - estimated))}</strong></div><div class="metric-item"><span>Tamamlama oranı</span><strong>%${completion}</strong></div>`;

  $("#workSessionTable").innerHTML = work.length ? [...work].sort((a, b) => `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`)).map(item => `<tr><td><strong>${escapeHtml(item.title)}</strong>${item.note ? `<br><small>${escapeHtml(item.note)}</small>` : ""}</td><td>${escapeHtml(relationLabel(item, "—"))}</td><td>${formatDate(item.date, { day: "numeric", month: "short", year: "numeric" })}</td><td>${formatTimeRange(item.start, item.end)}${item.breakMinutes ? `<br><small>${item.breakMinutes} dk mola</small>` : ""}</td><td>${formatDuration(item.minutes)}</td><td><div class="row-actions"><button class="icon-btn" data-edit="work" data-id="${item.id}">Düzenle</button><button class="icon-btn" data-delete="work" data-id="${item.id}">Sil</button></div></td></tr>`).join("") : `<tr><td colspan="6" class="empty-state">Bu ay çalışma kaydı yok.</td></tr>`;

  if (generatedReportRange) renderGeneratedWorkReport(false);
}

function renderGeneratedWorkReport(showMessage = true) {
  const start = $("#workReportStart").value;
  const end = $("#workReportEnd").value;
  if (!start || !end) return toast("Başlangıç ve bitiş tarihlerini seçin.");
  if (start > end) return toast("Başlangıç tarihi bitiş tarihinden sonra olamaz.");

  generatedReportRange = { start, end };
  const work = state.workSessions
    .filter(item => inDateRange(item.date, start, end))
    .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  const sales = state.sales
    .filter(item => inDateRange(item.date, start, end))
    .sort((a, b) => b.date.localeCompare(a.date));
  const won = wonSales(sales);
  const minutes = work.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const days = new Set(work.map(item => item.date)).size;
  const salesTotal = won.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const commission = won.reduce((sum, item) => sum + Number(item.commission || 0), 0);

  setText("#workReportPeriod", `${formatDate(start, { day: "numeric", month: "long", year: "numeric" })} – ${formatDate(end, { day: "numeric", month: "long", year: "numeric" })}`);
  setText("#workReportHours", formatDuration(minutes));
  setText("#workReportIncome", formatMoney(workIncome(work)));
  setText("#workReportDays", days);
  setText("#workReportCount", work.length);
  setText("#workReportSalesCount", sales.length);
  setText("#workReportSalesTotal", formatMoney(salesTotal));
  setText("#workReportCommission", formatMoney(commission));
  setText("#workReportCreatedAt", `Oluşturulma: ${new Date().toLocaleString("tr-TR", { dateStyle: "long", timeStyle: "short" })}`);
  $("#workReportTable").innerHTML = work.length ? work.map(item => `
    <tr>
      <td>${formatDate(item.date, { day: "numeric", month: "short", year: "numeric" })}</td>
      <td>${escapeHtml(formatTimeRange(item.start, item.end))}</td>
      <td><strong>${formatDuration(item.minutes)}</strong>${item.breakMinutes ? `<br><small>${Number(item.breakMinutes)} dk mola</small>` : ""}</td>
      <td><strong>${formatMoney(sessionIncome(item))}</strong><br><small>${formatMoney(sessionHourlyRate(item))}/sa</small></td>
      <td><strong>${escapeHtml(item.title)}</strong></td>
      <td class="report-note">${escapeHtml(item.note || "—")}</td>
    </tr>`).join("") : `<tr><td colspan="6" class="empty-state">Seçilen tarih aralığında çalışma kaydı bulunamadı.</td></tr>`;
  $("#workReportSalesTable").innerHTML = sales.length ? sales.map(item => `
    <tr>
      <td>${formatDate(item.date, { day: "numeric", month: "short", year: "numeric" })}</td>
      <td><strong>${escapeHtml(item.title)}</strong></td>
      <td>${escapeHtml(relationLabel(item, "—"))}</td>
      <td><span class="badge badge-${item.stage}">${stageLabel(item.stage)}</span></td>
      <td>${formatMoney(item.amount)}</td>
      <td><strong>${formatMoney(item.commission)}</strong><br><small>%${Number(item.commissionRate || 0)}</small></td>
      <td><span class="badge badge-${item.paymentStatus}">${paymentLabel(item.paymentStatus)}</span></td>
      <td class="report-note">${escapeHtml(item.note || "—")}</td>
    </tr>`).join("") : `<tr><td colspan="8" class="empty-state">Seçilen tarih aralığında satış kaydı bulunamadı.</td></tr>`;
  $("#generatedWorkReport").hidden = false;
  if (showMessage) {
    $("#generatedWorkReport").scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Çalışma raporu oluşturuldu.");
  }
}

function printGeneratedWorkReport() {
  if (!generatedReportRange || $("#generatedWorkReport").hidden) return toast("Önce bir çalışma raporu oluşturun.");
  document.body.classList.add("printing-work-report");
  window.print();
}

function loadScriptOnce(src, marker) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-lib="${marker}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("PDF kütüphanesi yüklenemedi.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.lib = marker;
    script.onload = () => { script.dataset.loaded = "1"; resolve(); };
    script.onerror = () => reject(new Error("PDF kütüphanesi yüklenemedi."));
    document.head.appendChild(script);
  });
}

async function loadPdfLibs() {
  await loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js", "jspdf");
  await loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.4/jspdf.plugin.autotable.min.js", "jspdf-autotable");
  if (!window.jspdf?.jsPDF) throw new Error("PDF kütüphanesi hazır değil.");
}

async function ensurePdfFont(doc) {
  if (ensurePdfFont.ready) {
    doc.addFileToVFS("DejaVuSans.ttf", ensurePdfFont.ready);
    doc.addFont("DejaVuSans.ttf", "ReportFont", "normal");
    doc.setFont("ReportFont", "normal");
    return;
  }
  const response = await fetch("https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf");
  if (!response.ok) throw new Error("PDF yazı tipi yüklenemedi.");
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  ensurePdfFont.ready = btoa(binary);
  doc.addFileToVFS("DejaVuSans.ttf", ensurePdfFont.ready);
  doc.addFont("DejaVuSans.ttf", "ReportFont", "normal");
  doc.setFont("ReportFont", "normal");
}

function collectWorkReportPdfData() {
  const { start, end } = generatedReportRange;
  const work = state.workSessions
    .filter(item => inDateRange(item.date, start, end))
    .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  const sales = state.sales
    .filter(item => inDateRange(item.date, start, end))
    .sort((a, b) => b.date.localeCompare(a.date));
  const won = wonSales(sales);
  return {
    start,
    end,
    work,
    sales,
    minutes: work.reduce((sum, item) => sum + Number(item.minutes || 0), 0),
    income: workIncome(work),
    days: new Set(work.map(item => item.date)).size,
    salesTotal: won.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    commission: won.reduce((sum, item) => sum + Number(item.commission || 0), 0)
  };
}

async function downloadGeneratedWorkReportPdf() {
  const report = $("#generatedWorkReport");
  if (!generatedReportRange || report?.hidden) return toast("Önce bir çalışma raporu oluşturun.");
  const button = $("#downloadWorkReportPdfBtn");
  const previousLabel = button?.textContent;
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "PDF hazırlanıyor…";
    }
    await loadPdfLibs();
    const data = collectWorkReportPdfData();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    await ensurePdfFont(doc);

    const period = `${formatDate(data.start, { day: "numeric", month: "long", year: "numeric" })} – ${formatDate(data.end, { day: "numeric", month: "long", year: "numeric" })}`;
    doc.setFontSize(10);
    doc.setTextColor(75, 85, 99);
    doc.text("ÇALIŞMA FAALİYET RAPORU", 14, 14);
    doc.setFontSize(18);
    doc.setTextColor(17, 24, 39);
    doc.text("Workstation", 14, 22);
    doc.setFontSize(10);
    doc.setTextColor(75, 85, 99);
    doc.text(period, 14, 28);
    doc.text(`Oluşturulma: ${new Date().toLocaleString("tr-TR", { dateStyle: "long", timeStyle: "short" })}`, 14, 34);

    doc.setFontSize(9);
    doc.setTextColor(17, 24, 39);
    doc.text([
      `Toplam çalışma: ${formatDuration(data.minutes)}`,
      `Çalışma kazancı: ${formatMoney(data.income)}`,
      `Çalışılan gün: ${data.days}`,
      `Çalışma kaydı: ${data.work.length}`,
      `Satış kaydı: ${data.sales.length}`,
      `Kazanılan satış: ${formatMoney(data.salesTotal)}`,
      `Prim: ${formatMoney(data.commission)}`
    ].join("   |   "), 14, 42);

    const tableOptions = {
      theme: "grid",
      styles: {
        font: "ReportFont",
        fontSize: 8,
        cellPadding: 2.2,
        overflow: "linebreak",
        valign: "top",
        textColor: [31, 41, 55],
        lineColor: [229, 231, 235],
        lineWidth: 0.2
      },
      headStyles: {
        font: "ReportFont",
        fontStyle: "normal",
        fillColor: [243, 244, 246],
        textColor: [55, 65, 81],
        fontSize: 8
      },
      margin: { left: 14, right: 14 }
    };

    doc.setFontSize(11);
    doc.text("Faaliyet dökümü", 14, 50);
    doc.autoTable({
      ...tableOptions,
      startY: 53,
      head: [["Tarih", "Saat", "Süre", "Kazanç", "Yapılan iş", "Açıklama"]],
      body: data.work.length
        ? data.work.map(item => [
          formatDate(item.date, { day: "numeric", month: "short", year: "numeric" }),
          formatTimeRange(item.start, item.end),
          `${formatDuration(item.minutes)}${item.breakMinutes ? ` (${Number(item.breakMinutes)} dk mola)` : ""}`,
          `${formatMoney(sessionIncome(item))} (${formatMoney(sessionHourlyRate(item))}/sa)`,
          item.title || "—",
          item.note || "—"
        ])
        : [["Seçilen aralıkta çalışma kaydı yok", "", "", "", "", ""]],
      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 26 },
        2: { cellWidth: 32 },
        3: { cellWidth: 36 },
        4: { cellWidth: 48 },
        5: { cellWidth: "auto" }
      }
    });

    const salesStart = (doc.lastAutoTable?.finalY || 60) + 10;
    doc.setFontSize(11);
    doc.setTextColor(17, 24, 39);
    doc.text("Satış dökümü", 14, salesStart);
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text("Prim tutarları kazanç hesabına dahil edilmeden bilgi amaçlı gösterilir", 14, salesStart + 5);

    doc.autoTable({
      ...tableOptions,
      startY: salesStart + 8,
      head: [["Tarih", "Satış", "Müşteri / Proje", "Aşama", "Tutar", "Prim", "Prim durumu", "Not"]],
      body: data.sales.length
        ? data.sales.map(item => [
          formatDate(item.date, { day: "numeric", month: "short", year: "numeric" }),
          item.title || "—",
          relationLabel(item, "—"),
          stageLabel(item.stage),
          formatMoney(item.amount),
          `${formatMoney(item.commission)} (%${Number(item.commissionRate || 0)})`,
          paymentLabel(item.paymentStatus),
          item.note || "—"
        ])
        : [["Seçilen aralıkta satış kaydı yok", "", "", "", "", "", "", ""]],
      columnStyles: {
        0: { cellWidth: 26 },
        1: { cellWidth: 32 },
        2: { cellWidth: 34 },
        3: { cellWidth: 24 },
        4: { cellWidth: 24 },
        5: { cellWidth: 28 },
        6: { cellWidth: 24 },
        7: { cellWidth: "auto" }
      }
    });

    doc.save(`${data.start}_${data.end} çalışma özetim.pdf`);
    toast("PDF indirildi.");
  } catch (error) {
    console.warn("PDF indirme başarısız", error);
    toast(error?.message || "PDF indirilemedi.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousLabel || "PDF olarak indir";
    }
  }
}

function clearGeneratedWorkReport() {
  generatedReportRange = null;
  $("#generatedWorkReport").hidden = true;
  $("#workReportForm").reset();
  $$("[data-report-preset]").forEach(button => button.classList.remove("active"));
  $("#workReportStart").focus();
  toast("Rapor görünümü temizlendi.");
}

function renderSettings() {
  $("#hourlyRate").value = state.settings.hourlyRate;
  $("#defaultCommissionRate").value = state.settings.defaultCommissionRate;
  $("#monthlySalesTarget").value = state.settings.monthlySalesTarget;
  $("#monthlyIncomeTarget").value = state.settings.monthlyIncomeTarget;
  $("#dailyWorkTargetHours").value = state.settings.dailyWorkTargetHours;
}

function populateSelects() {
  const customerOptions = state.customers.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
  $$('[data-customer-select]').forEach(select => {
    const current = select.value;
    const first = select.required ? `<option value="">Müşteri seç</option>` : `<option value="">Müşteri yok</option>`;
    select.innerHTML = first + customerOptions;
    select.value = current;
  });
  const projectOptions = state.projects.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
  $$('[data-project-select]').forEach(select => {
    const current = select.value;
    select.innerHTML = `<option value="">Proje yok</option>${projectOptions}`;
    select.value = current;
  });
  const todoOptions = state.todos.filter(item => item.status !== "done").map(item => `<option value="${item.id}">${escapeHtml(item.title)} (${formatDate(item.date)})</option>`).join("");
  $$('[data-todo-select]').forEach(select => {
    const current = select.value;
    select.innerHTML = `<option value="">Todo ile bağlama</option>${todoOptions}`;
    select.value = current;
  });
  preserveSelect("#todoProjectFilter", `<option value="all">Tüm projeler</option>${projectOptions}`);
  preserveSelect("#saleCustomerFilter", `<option value="all">Tüm müşteriler</option>${customerOptions}`);
}

function preserveSelect(selector, html) {
  const select = $(selector); if (!select) return;
  const current = select.value;
  select.innerHTML = html;
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

function statusLabel(value) { return ({ planned: "Planlandı", progress: "Devam ediyor", done: "Tamamlandı", postponed: "Ertelendi" })[value] || value; }
function priorityLabel(value) { return ({ high: "Yüksek", medium: "Orta", low: "Düşük" })[value] || value; }
function recurrenceLabel(value) { return ({ none: "Yok", daily: "Her gün", weekly: "Her hafta", monthly: "Her ay" })[value] || value; }
function stageLabel(value) { return ({ lead: "Potansiyel", contacted: "Görüşüldü", proposal: "Teklif", won: "Kazanıldı", lost: "Kaybedildi" })[value] || value; }
function paymentLabel(value) { return ({ pending: "Bekliyor", approved: "Onaylandı", paid: "Ödendi" })[value] || value; }
function projectStatusLabel(value) { return ({ active: "Aktif", paused: "Beklemede", completed: "Tamamlandı" })[value] || value; }

function navigate(viewName) {
  $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === viewName));
  $$(".view").forEach(view => view.classList.remove("active"));
  $(`#${viewName}View`)?.classList.add("active");
  const titles = { dashboard: "Genel Bakış", calendar: "Günlük Takvim", mywork: "Çalışmalarım", todos: "Todo Listesi", sales: "Satışlar ve Prim", crm: "Müşteriler ve Projeler", reports: "Raporlar", settings: "Ayarlar" };
  setText("#pageTitle", titles[viewName] || "Workstation");
  if (viewName === "reports") renderReports();
  if (viewName === "mywork") renderMyWork();
  if (viewName === "calendar") renderCalendar();
}

function completeTodo(id) {
  const item = todoById(id);
  if (!item || item.status === "done") return;
  item.status = "done";
  saveState(); renderAll(); toast("Todo tamamlandı.");
}

function reopenTodo(id) {
  const item = todoById(id);
  if (!item || item.status !== "done") return;
  item.status = "planned";
  saveState(); renderAll(); toast("Todo tekrar açıldı.");
}

function openModal(formName = null, { preserveSlot = false } = {}) {
  if (!preserveSlot) pendingSlotTime = null;
  populateSelects();
  $("#modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  showModalForm(formName);
}

function closeModal() {
  $("#modalBackdrop").hidden = true;
  document.body.style.overflow = "";
  pendingSlotTime = null;
  showModalForm(null);
}

function resetForms() {
  $$(".modal-form").forEach(form => {
    form.reset();
    $$("details", form).forEach(details => { details.open = false; });
    const edit = $("[name='editId']", form); if (edit) edit.value = "";
  });
  updateCommissionPreview();
}

function showModalForm(formName) {
  $("#quickActions").classList.toggle("hidden", Boolean(formName));
  $$(".modal-form").forEach(form => form.classList.add("hidden"));
  const titles = { timer: "Canlı Çalışma Sayacı", work: "Çalışma Kaydı", todo: "Todo", sale: "Satış ve Prim", customer: "Müşteri", project: "Proje", expense: "Gider" };
  setText("#modalTitle", formName ? titles[formName] : "Hızlı Ekle");
  if (!formName) { resetForms(); setSaleInlineCustomerOpen(false); return; }
  const form = $(`#${formName}Form`);
  if (!form) return;
  form.classList.remove("hidden");
  if (formName !== "sale") setSaleInlineCustomerOpen(false);
  const isNew = !$(`[name='editId']`, form)?.value;
  const dateInput = $("input[name='date']", form);
  if (dateInput && !dateInput.value) {
    const myWorkDate = $("#myworkView")?.classList.contains("active") ? $("#myWorkDate")?.value : "";
    dateInput.value = pendingSlotTime?.date || myWorkDate || $("#calendarDate")?.value || localDateString();
  }
  if (formName === "customer") {
    const meetingDate = $("[name='meetingDate']", form);
    const meetingStart = $("[name='meetingStart']", form);
    const meetingEnd = $("[name='meetingEnd']", form);
    const initialNote = $("[name='initialNote']", form);
    if (initialNote) initialNote.value = "";
    if (meetingDate) meetingDate.value = "";
    if (meetingStart) meetingStart.value = "";
    if (meetingEnd) meetingEnd.value = "";
    const meetingDetails = $("#customerMeetingPlan");
    if (meetingDetails) meetingDetails.open = false;
  }
  if (isNew) {
    const prefs = loadQuickPrefs();
    // Çalışma, todo ve proje kişisel olabilir; son müşteri/projeyi otomatik doldurma.
    if (formName !== "work" && formName !== "todo" && formName !== "project") {
      for (const name of ["customerId", "projectId"]) {
        const input = $(`[name='${name}']`, form);
        if (input && prefs[name] && [...input.options].some(option => option.value === prefs[name])) input.value = prefs[name];
      }
    }
    const rate = $(`[name='commissionRate']`, form);
    if (rate && !rate.value) {
      const defaultRate = state.settings.defaultCommissionRate;
      if (defaultRate != null && defaultRate !== "") rate.value = defaultRate;
      else if (prefs.commissionRate) rate.value = prefs.commissionRate;
    }
    const slot = pendingSlotTime;
    pendingSlotTime = null;
    const { start, end } = slot || roundedTimeRange();
    const startInput = $(`[name='start']`, form); const endInput = $(`[name='end']`, form);
    if (startInput && (!startInput.value || slot)) startInput.value = start;
    if (endInput && (!endInput.value || slot)) endInput.value = end;
    updateCommissionPreview();
  } else {
    pendingSlotTime = null;
  }
  setTimeout(() => $("input:not([type='hidden']),select", form)?.focus(), 30);
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2300);
}

function formData(form) {
  return Object.fromEntries(new FormData(form));
}

function upsert(collection, item) {
  const index = collection.findIndex(existing => existing.id === item.id);
  if (index >= 0) collection[index] = item;
  else collection.push(item);
}

function submitWork(form) {
  const data = formData(form);
  const breakMinutes = Number(data.breakMinutes || 0);
  const rawMinutes = minutesBetween(data.start, data.end);
  const minutes = rawMinutes - breakMinutes;
  if (!Number.isFinite(rawMinutes) || rawMinutes <= 0) return toast("Geçerli bir başlangıç ve bitiş saati girin.");
  if (data.start === data.end) return toast("Başlangıç ve bitiş saati aynı olamaz.");
  if (minutes <= 0) return toast("Mola süresi toplam süreden kısa olmalı.");
  const existing = state.workSessions.find(item => item.id === data.editId);
  const conflict = findWorkConflict({ date: data.date, start: data.start, end: data.end, id: data.editId });
  if (conflict) return toast(`Bu zaman aralığı “${conflict.title}” kaydıyla çakışıyor.`);
  const project = projectById(data.projectId);
  const item = { id: data.editId || uid(), title: data.title.trim(), customerId: data.customerId || project?.customerId || "", projectId: data.projectId || "", todoId: data.todoId || "", date: data.date, start: data.start, end: data.end, breakMinutes, minutes, hourlyRate: sessionHourlyRate(existing), note: (data.note || "").trim(), createdAt: existing?.createdAt || Date.now() };
  upsert(state.workSessions, item); rememberFormChoices(data); saveState(); form.reset(); closeModal(); renderAll();
  const overnightNote = isOvernightRange(data.start, data.end) ? " (ertesi güne sarkıyor)" : "";
  toast((existing ? "Çalışma güncellendi." : "Çalışma kaydı eklendi.") + overnightNote);
}

function submitTodo(form) {
  const data = formData(form);
  const duration = minutesBetween(data.start, data.end);
  if (!Number.isFinite(duration) || duration <= 0) return toast("Geçerli bir başlangıç ve bitiş saati girin.");
  if (data.start === data.end) return toast("Başlangıç ve bitiş saati aynı olamaz.");
  const existing = state.todos.find(item => item.id === data.editId);
  const project = projectById(data.projectId);
  const item = { id: data.editId || uid(), title: data.title.trim(), customerId: data.customerId || project?.customerId || "", projectId: data.projectId || "", priority: data.priority, status: data.status, date: data.date, start: data.start, end: data.end, recurrence: data.recurrence, note: (data.note || "").trim(), createdAt: existing?.createdAt || Date.now(), recurrenceGeneratedAt: existing?.recurrenceGeneratedAt || "" };
  upsert(state.todos, item); rememberFormChoices(data); saveState(); form.reset(); closeModal(); renderAll();
  const overnightNote = isOvernightRange(data.start, data.end) ? " (ertesi güne sarkıyor)" : "";
  toast((existing ? "Todo güncellendi." : "Todo eklendi.") + overnightNote);
}

function submitSale(form) {
  const data = formData(form);
  const amount = Number(data.amount || 0); const commissionRate = Number(data.commissionRate || 0);
  const existing = state.sales.find(item => item.id === data.editId);
  const project = projectById(data.projectId);
  const paidAt = data.paymentStatus === "paid" ? (data.paidAt || data.date) : data.paidAt;
  const item = {
    id: data.editId || uid(),
    title: data.title.trim(),
    customerId: data.customerId || project?.customerId || "",
    projectId: data.projectId || "",
    date: data.date,
    time: existing?.time || localTimeString(),
    amount,
    commissionRate,
    commission: roundMoney(amount * commissionRate / 100),
    stage: data.stage,
    paymentStatus: data.paymentStatus,
    expectedPaymentDate: data.expectedPaymentDate || "",
    paidAt: paidAt || "",
    note: (data.note || "").trim(),
    createdAt: existing?.createdAt || Date.now()
  };
  upsert(state.sales, item); rememberFormChoices(data); saveState(); form.reset(); updateCommissionPreview(); closeModal(); renderAll(); toast(existing ? "Satış güncellendi." : "Satış kaydedildi.");
}

function toggleCustomerDemoMeeting(id) {
  const customer = customerById(id);
  if (!customer) return;
  customer.demoMeetingDone = !customer.demoMeetingDone;
  saveState();
  renderCrm();
  toast(customer.demoMeetingDone ? "Demo toplantısı yapıldı olarak işaretlendi." : "Demo toplantısı bekliyor olarak işaretlendi.");
}

function renderCustomerNotesPanel() {
  const panel = $("#customerNotesPanel");
  const backdrop = $("#customerNotesBackdrop");
  if (!panel || !backdrop) return;
  if (!activeNotesCustomerId) {
    panel.hidden = true;
    backdrop.hidden = true;
    document.body.classList.remove("notes-open");
    return;
  }
  const customer = customerById(activeNotesCustomerId);
  if (!customer) {
    activeNotesCustomerId = null;
    editingNoteId = null;
    panel.hidden = true;
    backdrop.hidden = true;
    document.body.classList.remove("notes-open");
    return;
  }
  const notes = [...(customer.notes || [])].sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  setText("#customerNotesTitle", customer.name);
  setText("#customerNotesCount", notes.length ? `${notes.length} not` : "Henüz not yok");
  const editor = $("#customerNoteText");
  const submitBtn = $("#customerNoteSubmit");
  const cancelBtn = $("#customerNoteCancelEdit");
  if (editor && !editingNoteId) editor.value = "";
  if (submitBtn) submitBtn.textContent = editingNoteId ? "Notu Güncelle" : "Not Ekle";
  if (cancelBtn) cancelBtn.hidden = !editingNoteId;
  $("#customerNotesList").innerHTML = notes.length
    ? notes.map(note => `<article class="customer-note-item${editingNoteId === note.id ? " is-editing" : ""}">
        <div class="customer-note-meta"><time datetime="${new Date(note.createdAt).toISOString()}">${escapeHtml(formatDateTime(note.updatedAt || note.createdAt))}</time>${note.updatedAt && note.updatedAt !== note.createdAt ? "<small>güncellendi</small>" : ""}</div>
        <p>${escapeHtml(note.text)}</p>
        <div class="row-actions">
          <button type="button" class="icon-btn" data-edit-note="${note.id}">Düzenle</button>
          <button type="button" class="icon-btn" data-delete-note="${note.id}">Sil</button>
        </div>
      </article>`).join("")
    : `<div class="empty-state">Bu müşteri için henüz not eklenmedi. İlk görüşme notunu yukarıdan yazabilirsiniz.</div>`;
  panel.hidden = false;
  backdrop.hidden = false;
  document.body.classList.add("notes-open");
}

function openCustomerNotes(customerId) {
  const customer = customerById(customerId);
  if (!customer) return;
  activeNotesCustomerId = customerId;
  editingNoteId = null;
  renderCustomerNotesPanel();
  setTimeout(() => $("#customerNoteText")?.focus(), 30);
}

function closeCustomerNotes() {
  activeNotesCustomerId = null;
  editingNoteId = null;
  const editor = $("#customerNoteText");
  if (editor) editor.value = "";
  renderCustomerNotesPanel();
}

function addOrUpdateCustomerNote() {
  const customer = customerById(activeNotesCustomerId);
  const editor = $("#customerNoteText");
  if (!customer || !editor) return;
  const text = editor.value.trim();
  if (!text) return toast("Not metni boş olamaz.");
  if (!Array.isArray(customer.notes)) customer.notes = [];
  if (editingNoteId) {
    const note = customer.notes.find(item => item.id === editingNoteId);
    if (!note) return toast("Not bulunamadı.");
    note.text = text;
    note.updatedAt = Date.now();
    editingNoteId = null;
    toast("Not güncellendi.");
  } else {
    customer.notes = [makeCustomerNote(text), ...customer.notes];
    toast("Not eklendi.");
  }
  syncCustomerNoteSummary(customer);
  editor.value = "";
  saveState();
  renderCrm();
  renderCustomerNotesPanel();
}

function beginEditCustomerNote(noteId) {
  const customer = customerById(activeNotesCustomerId);
  const note = customer?.notes?.find(item => item.id === noteId);
  if (!note) return;
  editingNoteId = noteId;
  const editor = $("#customerNoteText");
  if (editor) {
    editor.value = note.text;
    editor.focus();
  }
  renderCustomerNotesPanel();
}

function deleteCustomerNote(noteId) {
  const customer = customerById(activeNotesCustomerId);
  if (!customer || !Array.isArray(customer.notes)) return;
  if (!confirm("Bu not silinsin mi?")) return;
  customer.notes = customer.notes.filter(item => item.id !== noteId);
  if (editingNoteId === noteId) {
    editingNoteId = null;
    const editor = $("#customerNoteText");
    if (editor) editor.value = "";
  }
  syncCustomerNoteSummary(customer);
  saveState();
  renderCrm();
  renderCustomerNotesPanel();
  toast("Not silindi.");
}

function createMeetingTodoForCustomer(customer, plan = {}) {
  const date = String(plan.date || "").trim();
  const start = String(plan.start || "").trim();
  const end = String(plan.end || "").trim();
  if (!date && !start && !end) return null;
  if (!date || !start || !end) {
    toast("Toplantı için tarih, başlangıç ve bitiş saatini birlikte girin.");
    return false;
  }
  const duration = minutesBetween(start, end);
  if (!Number.isFinite(duration) || duration <= 0 || start === end) {
    toast("Toplantı için geçerli bir saat aralığı girin.");
    return false;
  }
  const note = String(plan.note || "").trim();
  const item = {
    id: uid(),
    title: `Toplantı — ${customer.name}`,
    customerId: customer.id,
    projectId: "",
    priority: "high",
    status: "planned",
    date,
    start,
    end,
    recurrence: "none",
    note,
    createdAt: Date.now(),
    recurrenceGeneratedAt: ""
  };
  upsert(state.todos, item);
  return item;
}

function appendCustomerNote(customer, text) {
  const clean = String(text || "").trim();
  if (!clean) return customer;
  const notes = [makeCustomerNote(clean), ...(customer.notes || []).map(note => ({ ...note }))];
  return syncCustomerNoteSummary({ ...customer, notes });
}

function submitCustomer(form) {
  const data = formData(form);
  const existing = state.customers.find(item => item.id === data.editId);
  let item = syncCustomerNoteSummary({
    id: data.editId || uid(),
    name: data.name.trim(),
    contact: (data.contact || "").trim(),
    email: (data.email || "").trim(),
    phone: (data.phone || "").trim(),
    notes: existing?.notes ? existing.notes.map(note => ({ ...note })) : [],
    note: existing?.note || "",
    demoMeetingDone: Boolean($("[name='demoMeetingDone']", form)?.checked),
    createdAt: existing?.createdAt || Date.now()
  });
  const initialNote = (data.initialNote || "").trim();
  if (initialNote) item = appendCustomerNote(item, initialNote);
  const meeting = createMeetingTodoForCustomer(item, {
    date: data.meetingDate,
    start: data.meetingStart,
    end: data.meetingEnd,
    note: initialNote
  });
  if (meeting === false) return;
  upsert(state.customers, item);
  saveState();
  form.reset();
  closeModal();
  renderAll();
  const meetingNote = meeting ? " Toplantı takvime eklendi." : "";
  toast((existing ? "Müşteri güncellendi." : "Müşteri eklendi.") + meetingNote);
}

function clearSaleInlineCustomerFields() {
  for (const id of [
    "saleNewCustomerName",
    "saleNewCustomerNote",
    "saleNewCustomerMeetingDate",
    "saleNewCustomerMeetingStart",
    "saleNewCustomerMeetingEnd"
  ]) {
    const input = $(`#${id}`);
    if (input) input.value = "";
  }
}

function setSaleInlineCustomerOpen(open) {
  const panel = $("#saleInlineCustomer");
  const button = $("#saleNewCustomerBtn");
  if (!panel || !button) return;
  panel.hidden = !open;
  button.setAttribute("aria-expanded", open ? "true" : "false");
  if (!open) {
    clearSaleInlineCustomerFields();
    return;
  }
  setTimeout(() => $("#saleNewCustomerName")?.focus(), 30);
}

function createCustomerFromSaleForm() {
  const input = $("#saleNewCustomerName");
  const name = (input?.value || "").trim();
  if (!name) {
    toast("Şirket adı girin.");
    input?.focus();
    return;
  }
  const noteText = ($("#saleNewCustomerNote")?.value || "").trim();
  const meetingPlan = {
    date: $("#saleNewCustomerMeetingDate")?.value || "",
    start: $("#saleNewCustomerMeetingStart")?.value || "",
    end: $("#saleNewCustomerMeetingEnd")?.value || "",
    note: noteText
  };
  const hasMeetingIntent = Boolean(meetingPlan.date || meetingPlan.start || meetingPlan.end);
  const duplicate = state.customers.find(item => item.name.trim().toLocaleLowerCase("tr-TR") === name.toLocaleLowerCase("tr-TR"));
  if (duplicate) {
    populateSelects();
    const select = $("#saleCustomerSelect") || $("[name='customerId']", $("#saleForm"));
    if (select) select.value = duplicate.id;
    if (noteText) {
      const updated = appendCustomerNote(duplicate, noteText);
      upsert(state.customers, updated);
    }
    let meeting = null;
    if (hasMeetingIntent) {
      meeting = createMeetingTodoForCustomer(duplicate, meetingPlan);
      if (meeting === false) return;
    }
    saveState();
    populateSelects();
    renderAll();
    setSaleInlineCustomerOpen(false);
    toast(meeting ? "Mevcut müşteri seçildi; not ve toplantı eklendi." : "Bu müşteri zaten var; seçildi.");
    return;
  }
  let item = syncCustomerNoteSummary({
    id: uid(),
    name,
    contact: "",
    email: "",
    phone: "",
    notes: [],
    note: "",
    demoMeetingDone: false,
    createdAt: Date.now()
  });
  if (noteText) item = appendCustomerNote(item, noteText);
  const meeting = hasMeetingIntent ? createMeetingTodoForCustomer(item, meetingPlan) : null;
  if (meeting === false) return;
  upsert(state.customers, item);
  saveState();
  populateSelects();
  renderAll();
  const select = $("#saleCustomerSelect") || $("[name='customerId']", $("#saleForm"));
  if (select) select.value = item.id;
  rememberFormChoices({ customerId: item.id });
  setSaleInlineCustomerOpen(false);
  toast(meeting ? "Müşteri eklendi; toplantı takvime yazıldı." : "Müşteri eklendi; satış formunda seçildi.");
}

function submitProject(form) {
  const data = formData(form); const existing = state.projects.find(item => item.id === data.editId);
  const item = { id: data.editId || uid(), name: data.name.trim(), customerId: data.customerId || "", status: data.status, color: data.color || "#4f7cff", note: (data.note || "").trim(), createdAt: existing?.createdAt || Date.now() };
  upsert(state.projects, item); saveState(); form.reset(); closeModal(); renderAll(); toast(existing ? "Proje güncellendi." : "Proje eklendi.");
}

function submitExpense(form) {
  const data = formData(form); const existing = state.expenses.find(item => item.id === data.editId);
  const item = { id: data.editId || uid(), title: data.title.trim(), category: data.category, projectId: data.projectId || "", date: data.date, amount: Number(data.amount || 0), note: (data.note || "").trim(), createdAt: existing?.createdAt || Date.now() };
  upsert(state.expenses, item); saveState(); form.reset(); closeModal(); renderAll(); toast(existing ? "Gider güncellendi." : "Gider eklendi.");
}

function updateCommissionPreview() {
  const form = $("#saleForm"); if (!form) return;
  const amount = Number($("[name='amount']", form)?.value || 0);
  const rate = Number($("[name='commissionRate']", form)?.value || 0);
  setText("#commissionPreview", formatMoney(amount * rate / 100));
}

function openEdit(type, id) {
  const map = { work: [state.workSessions, "workForm"], todo: [state.todos, "todoForm"], sale: [state.sales, "saleForm"], customer: [state.customers, "customerForm"], project: [state.projects, "projectForm"], expense: [state.expenses, "expenseForm"] };
  const [collection, formId] = map[type] || [];
  const item = collection?.find(record => record.id === id); if (!item) return;
  openModal(type);
  const form = $(`#${formId}`);
  Object.entries(item).forEach(([key, value]) => {
    const input = $(`[name='${key}']`, form);
    if (!input) return;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value ?? "";
  });
  $("[name='editId']", form).value = item.id;
  updateCommissionPreview();
}

function deleteItem(type, id) {
  const map = { todo: "todos", sale: "sales", work: "workSessions", customer: "customers", project: "projects", expense: "expenses" };
  const key = map[type]; if (!key) return;
  if (type === "customer" && state.projects.some(project => project.customerId === id)) return toast("Önce bu müşteriye bağlı projeleri silin veya taşıyın.");
  state[key] = state[key].filter(item => item.id !== id);
  if (type === "project") {
    for (const list of [state.workSessions, state.todos, state.sales, state.expenses]) list.forEach(item => { if (item.projectId === id) item.projectId = ""; });
  }
  saveState(); renderAll(); toast("Kayıt silindi.");
}

function startTodoTimer(id) {
  if (state.timer?.running) return toast("Önce mevcut sayacı bitirin.");
  const todo = todoById(id); if (!todo) return;
  startTimer({
    title: todo.title,
    customerId: todo.customerId || "",
    projectId: todo.projectId || "",
    todoId: todo.id,
    note: todo.note || ""
  });
}

function exportData() {
  const backup = { format: BACKUP_FORMAT, formatVersion: 1, exportedAt: new Date().toISOString(), appVersion: state.version, data: state };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = `workstation-${localDateString()}.json`; link.click(); URL.revokeObjectURL(url);
}

function importData(file) {
  if (file.size > MAX_IMPORT_BYTES) return toast("Yedek dosyası 5 MB sınırını aşıyor.");
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = validateImportedState(JSON.parse(reader.result));
      const counts = `Çalışma: ${imported.workSessions.length}, satış: ${imported.sales.length}, todo: ${imported.todos.length}`;
      if (!confirm(`Yedek doğrulandı (${counts}). Mevcut verilerin yerine yüklensin mi?`)) return;
      localStorage.setItem(SAFETY_BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), data: state }));
      state = imported; saveState(); renderAll(); toast("Veriler doğrulandı ve içe aktarıldı. Önceki veriler güvenlik kopyasında tutuluyor.");
    } catch (error) { toast(error.message || "Dosya okunamadı veya geçersiz."); }
  };
  reader.onerror = () => toast("Yedek dosyası okunamadı.");
  reader.readAsText(file);
}

function exportCsv() {
  const month = selectedMonthValue();
  const rows = [["Tür", "Başlık", "Müşteri", "Proje", "Tarih", "Süre (dk)", "Çalışma Kazancı", "Satış", "Prim Bilgisi", "Prim Durumu"]];
  state.workSessions.filter(item => inMonth(item.date, month)).forEach(item => rows.push(["Çalışma", item.title, customerById(item.customerId)?.name || "", projectById(item.projectId)?.name || "", item.date, item.minutes, sessionIncome(item), "", "", ""]));
  wonSales(state.sales.filter(item => inMonth(item.date, month))).forEach(item => rows.push(["Satış", item.title, customerById(item.customerId)?.name || "", projectById(item.projectId)?.name || "", item.date, "", "", item.amount, item.commission, paymentLabel(item.paymentStatus)]));
  const csv = "\ufeff" + rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = `aylik-rapor-${month}.csv`; link.click(); URL.revokeObjectURL(url);
}

function bindEvents() {
  $("#themeToggle").addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
  });
  $$(".nav-item").forEach(button => button.addEventListener("click", () => navigate(button.dataset.view)));
  $$('[data-view-link]').forEach(button => button.addEventListener("click", () => navigate(button.dataset.viewLink)));
  $$(".period-tab").forEach(button => button.addEventListener("click", () => {
    setPeriodPreset(button.dataset.period);
    renderDashboard();
  }));
  ["periodStart", "periodEnd"].forEach(id => {
    $(`#${id}`)?.addEventListener("change", () => {
      setCustomPeriodFromInputs();
      renderDashboard();
    });
  });
  $("#quickAddBtn").addEventListener("click", () => openModal());
  document.addEventListener("click", event => {
    const open = event.target.closest("[data-open-modal]"); if (open) openModal(open.dataset.openModal);
    const timerOpen = event.target.closest("[data-open-timer]"); if (timerOpen) state.timer?.running ? toggleTimer() : startTimer();
    const timerToggle = event.target.closest("[data-timer-toggle]"); if (timerToggle) toggleTimer();
    const stop = event.target.closest("[data-stop-timer]"); if (stop) stopTimer();
    const select = event.target.closest("[data-select-form]"); if (select) showModalForm(select.dataset.selectForm);
    const del = event.target.closest("[data-delete]");
    if (del) {
      event.preventDefault();
      if (confirm("Bu kaydı silmek istediğinize emin misiniz?")) deleteItem(del.dataset.delete, del.dataset.id);
      return;
    }
    const edit = event.target.closest("[data-edit]"); if (edit) openEdit(edit.dataset.edit, edit.dataset.id);
    const todoComplete = event.target.closest("[data-complete-todo]"); if (todoComplete) completeTodo(todoComplete.dataset.completeTodo);
    const todoReopen = event.target.closest("[data-reopen-todo]"); if (todoReopen) reopenTodo(todoReopen.dataset.reopenTodo);
    const startTodo = event.target.closest("[data-start-todo]"); if (startTodo) startTodoTimer(startTodo.dataset.startTodo);
    const demoToggle = event.target.closest("[data-toggle-demo]"); if (demoToggle) toggleCustomerDemoMeeting(demoToggle.dataset.toggleDemo);
    const openNotes = event.target.closest("[data-open-notes]"); if (openNotes) openCustomerNotes(openNotes.dataset.openNotes);
    const editNote = event.target.closest("[data-edit-note]"); if (editNote) beginEditCustomerNote(editNote.dataset.editNote);
    const deleteNote = event.target.closest("[data-delete-note]"); if (deleteNote) deleteCustomerNote(deleteNote.dataset.deleteNote);
    const calendarDay = event.target.closest("[data-calendar-day]");
    if (calendarDay && $("#calendarDate")) {
      $("#calendarDate").value = calendarDay.dataset.calendarDay;
      renderCalendar();
    }
    const calendarSlot = event.target.closest("[data-calendar-slot]");
    if (calendarSlot) openCalendarSlot(Number(calendarSlot.dataset.calendarSlot));
    const calPreset = event.target.closest("[data-cal-preset]");
    if (calPreset) openCalendarPreset(calPreset.dataset.calPreset);
    const preset = event.target.closest("[data-report-preset]");
    if (preset) {
      const today = new Date(); let start = today; let end = today;
      if (preset.dataset.reportPreset === "today") start = today;
      if (preset.dataset.reportPreset === "week") start = startOfWeek(today);
      if (preset.dataset.reportPreset === "month") start = startOfMonth(today);
      if (preset.dataset.reportPreset === "last-month") {
        start = startOfMonth(addMonths(today, -1));
        end = new Date(today.getFullYear(), today.getMonth(), 0);
      }
      $("#workReportStart").value = localDateString(start); $("#workReportEnd").value = localDateString(end);
      $$("[data-report-preset]").forEach(button => button.classList.toggle("active", button === preset));
    }
  });
  $("#modalClose").addEventListener("click", closeModal);
  $("#modalBackdrop").addEventListener("click", event => { if (event.target === event.currentTarget) closeModal(); });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!$("#customerNotesPanel")?.hidden) closeCustomerNotes();
    else if (!$("#modalBackdrop").hidden) closeModal();
  });
  $("#customerNotesClose")?.addEventListener("click", closeCustomerNotes);
  $("#customerNotesBackdrop")?.addEventListener("click", closeCustomerNotes);
  $("#customerNoteCancelEdit")?.addEventListener("click", () => {
    editingNoteId = null;
    const editor = $("#customerNoteText");
    if (editor) editor.value = "";
    renderCustomerNotesPanel();
  });
  $("#customerNoteForm")?.addEventListener("submit", event => {
    event.preventDefault();
    addOrUpdateCustomerNote();
  });

  $("#timerForm").addEventListener("submit", event => { event.preventDefault(); startTimer(formData(event.currentTarget)); });
  $("#workForm").addEventListener("submit", event => { event.preventDefault(); submitWork(event.currentTarget); });
  $("#todoForm").addEventListener("submit", event => { event.preventDefault(); submitTodo(event.currentTarget); });
  $("#saleForm").addEventListener("submit", event => { event.preventDefault(); submitSale(event.currentTarget); });
  $("#customerForm").addEventListener("submit", event => { event.preventDefault(); submitCustomer(event.currentTarget); });
  $("#projectForm").addEventListener("submit", event => { event.preventDefault(); submitProject(event.currentTarget); });
  $("#expenseForm").addEventListener("submit", event => { event.preventDefault(); submitExpense(event.currentTarget); });
  $("[name='amount']", $("#saleForm")).addEventListener("input", updateCommissionPreview);
  $("[name='commissionRate']", $("#saleForm")).addEventListener("input", updateCommissionPreview);
  $("#saleNewCustomerBtn")?.addEventListener("click", () => {
    const panel = $("#saleInlineCustomer");
    setSaleInlineCustomerOpen(Boolean(panel?.hidden));
  });
  $("#saleNewCustomerSave")?.addEventListener("click", createCustomerFromSaleForm);
  $("#saleNewCustomerCancel")?.addEventListener("click", () => setSaleInlineCustomerOpen(false));
  $("#saleNewCustomerName")?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      createCustomerFromSaleForm();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSaleInlineCustomerOpen(false);
    }
  });

  $("#calendarDate").addEventListener("change", renderCalendar);
  $("#prevDayBtn").addEventListener("click", () => { $("#calendarDate").value = localDateString(addDays(parseLocalDate($("#calendarDate").value), -1)); renderCalendar(); });
  $("#nextDayBtn").addEventListener("click", () => { $("#calendarDate").value = localDateString(addDays(parseLocalDate($("#calendarDate").value), 1)); renderCalendar(); });
  $("#todayBtn").addEventListener("click", () => { $("#calendarDate").value = localDateString(); renderCalendar(); });
  $("#myWorkDate").addEventListener("change", renderMyWork);
  $("#myWorkPrevDay").addEventListener("click", () => { $("#myWorkDate").value = localDateString(addDays(parseLocalDate($("#myWorkDate").value), -1)); renderMyWork(); });
  $("#myWorkNextDay").addEventListener("click", () => { $("#myWorkDate").value = localDateString(addDays(parseLocalDate($("#myWorkDate").value), 1)); renderMyWork(); });
  $("#myWorkToday").addEventListener("click", () => { $("#myWorkDate").value = localDateString(); renderMyWork(); });
  for (const selector of ["#todoStatusFilter", "#todoPriorityFilter", "#todoProjectFilter", "#todoDateFilter"]) $(selector).addEventListener("change", renderTodos);
  for (const selector of ["#saleStageFilter", "#salePaymentFilter", "#saleCustomerFilter"]) $(selector).addEventListener("change", renderSales);
  $("#reportMonth").addEventListener("change", renderReports);
  $("#workReportForm").addEventListener("submit", event => { event.preventDefault(); renderGeneratedWorkReport(); });
  $("#clearWorkReportBtn").addEventListener("click", clearGeneratedWorkReport);
  $("#printWorkReportBtn").addEventListener("click", printGeneratedWorkReport);
  $("#downloadWorkReportPdfBtn")?.addEventListener("click", () => { downloadGeneratedWorkReportPdf(); });
  window.addEventListener("afterprint", () => document.body.classList.remove("printing-work-report"));

  $("#settingsForm").addEventListener("submit", event => {
    event.preventDefault();
    state.settings.hourlyRate = Number($("#hourlyRate").value);
    state.settings.defaultCommissionRate = Number($("#defaultCommissionRate").value);
    state.settings.monthlySalesTarget = Number($("#monthlySalesTarget").value);
    state.settings.monthlyIncomeTarget = Number($("#monthlyIncomeTarget").value);
    state.settings.dailyWorkTargetHours = Number($("#dailyWorkTargetHours").value);
    saveState(); renderAll(); toast("Ayarlar kaydedildi.");
  });
  $("#exportBtn").addEventListener("click", exportData);
  $("#importInput").addEventListener("change", event => { const [file] = event.target.files; if (file) importData(file); event.target.value = ""; });
  $("#exportCsvBtn").addEventListener("click", exportCsv);
  $("#printReportBtn").addEventListener("click", () => window.print());
  $("#resetBtn").addEventListener("click", () => {
    if (!confirm("Tüm yerel kayıtlar silinecek. Devam edilsin mi?")) return;
    clearAllLocalData();
    renderAll();
    toast("Tüm veriler silindi.");
  });
}

function clearAllLocalData() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  state = clone(defaultState);
  saveState();
  // seeded=1: boş kalır; aksi halde yenileyince demo veriler yeniden yüklenirdi
  localStorage.setItem(`${STORAGE_KEY}.seeded`, "1");
  localStorage.removeItem(QUICK_PREFS_KEY);
  localStorage.removeItem(SAFETY_BACKUP_KEY);
  localStorage.removeItem(OLD_STORAGE_KEY);
  customPeriodRange = null;
  selectedPeriod = "day";
  generatedReportRange = null;
  pendingSlotTime = null;
  activeNotesCustomerId = null;
  editingNoteId = null;
  if (typeof setPeriodPreset === "function") setPeriodPreset("day");
}

function init() {
  state = loadState();
  seedDemoData();
  state = loadState();
  const today = new Date();
  setText("#todayLabel", today.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  $("#calendarDate").value = localDateString();
  $("#myWorkDate").value = localDateString();
  $("#reportMonth").value = localDateString().slice(0, 7);
  $("#workReportStart").value = localDateString(startOfMonth(today));
  $("#workReportEnd").value = localDateString(today);
  setPeriodPreset("day");
  bindEvents(); renderAll();
}

init();
