// ── 日付ユーティリティ ────────────────────────────────────────────────────
// 2026年の日本の祝日（YYYY-MM-DD 形式）
const HOLIDAYS = new Set([
  "2026-01-01", // 元日
  "2026-01-12", // 成人の日
  "2026-02-11", // 建国記念の日
  "2026-02-23", // 天皇誕生日
  "2026-03-20", // 春分の日
  "2026-04-29", // 昭和の日
  "2026-05-03", // 憲法記念日
  "2026-05-04", // みどりの日
  "2026-05-05", // こどもの日
  "2026-07-20", // 海の日
  "2026-08-11", // 山の日
  "2026-09-21", // 敬老の日
  "2026-09-23", // 秋分の日
  "2026-10-12", // スポーツの日
  "2026-11-03", // 文化の日
  "2026-11-23", // 勤労感謝の日
]);
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

// HTMLスパン付きで曜日・土日祝カラーを返す（テーブルセル等に使用）
function fmtDate(dateStr) {
  if (!dateStr) return dateStr;
  const d = new Date(dateStr + "T00:00:00");
  const wd = d.getDay();
  const label = `${dateStr} (${WEEKDAY_JA[wd]})`;
  if (HOLIDAYS.has(dateStr) || wd === 0) return `<span class="day-sun">${label}</span>`;
  if (wd === 6) return `<span class="day-sat">${label}</span>`;
  return label;
}

// プレーンテキストで曜日を返す（select option 等に使用）
function fmtDateText(dateStr) {
  if (!dateStr) return dateStr;
  const d = new Date(dateStr + "T00:00:00");
  return `${dateStr} (${WEEKDAY_JA[d.getDay()]})`;
}

// ── パスワード認証 ────────────────────────────────────────────────────────
const PW_HASH = "e12fd2d9aea614423c629f54503faba614d968dc4057ce10c071093cc04f46fe";
const SESSION_KEY = "shd_auth";

async function sha256(text) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function checkPassword() {
  const input = document.getElementById("pw-input").value;
  const hash = await sha256(input);
  if (hash === PW_HASH) {
    sessionStorage.setItem(SESSION_KEY, "1");
    showMain();
  } else {
    document.getElementById("auth-error").textContent = "パスワードが違います";
    document.getElementById("pw-input").value = "";
    document.getElementById("pw-input").focus();
  }
}

function showMain() {
  document.getElementById("auth-screen").style.display = "none";
  document.getElementById("main-content").style.display = "block";
  init();
}

// Enter キーでログイン・セッション維持
document.addEventListener("DOMContentLoaded", () => {
  if (sessionStorage.getItem(SESSION_KEY) === "1") {
    showMain();
    return;
  }
  document.getElementById("pw-input").addEventListener("keydown", e => {
    if (e.key === "Enter") checkPassword();
  });
  document.getElementById("pw-input").focus();
});

// ソートヘッダーのイベント委任（初回1回のみ登録）
document.addEventListener("DOMContentLoaded", () => {
  document.querySelector("#machine-table thead").addEventListener("click", e => {
    const th = e.target.closest("th.sortable");
    if (!th) return;
    if (modalSortCol === th.dataset.col) {
      modalSortAsc = !modalSortAsc;
    } else {
      modalSortCol = th.dataset.col;
      // 差枚・G数・確率は降順スタート、台番・機種名は昇順スタート
      modalSortAsc = ["machine_number", "machine_name"].includes(modalSortCol);
    }
    renderMachineTable();
  });

  document.querySelector("#model-table thead").addEventListener("click", e => {
    const th = e.target.closest("th.sortable");
    if (!th) return;
    if (modelSortCol === th.dataset.col) {
      modelSortAsc = !modelSortAsc;
    } else {
      modelSortCol = th.dataset.col;
      modelSortAsc = th.dataset.col === "machine_name";
    }
    renderModelTable();
  });
});

// ── 数値フォーマット ──────────────────────────────────────────────────────
function fmtDiff(v) {
  if (v === null || v === undefined) return "—";
  const s = v >= 0 ? "+" : "";
  return s + v.toLocaleString();
}
function diffClass(v) {
  if (v === null || v === undefined) return "";
  return v >= 0 ? "pos" : "neg";
}
// ── ソートインジケーター更新 ──────────────────────────────────────────────
function updateSortIndicators(tableId, sortCol, sortAsc) {
  document.querySelectorAll(`#${tableId} th.sortable`).forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.col === sortCol) {
      th.classList.add(sortAsc ? "sort-asc" : "sort-desc");
    }
  });
}

// ── ページャー状態更新 ────────────────────────────────────────────────────
// pagerId: ページャー div の id（例: "top-machines-pager"）
// infoId / prevId / nextId: 対応する子要素 id
function setPagerState(pagerId, infoId, prevId, nextId, show, info, atFirst, atLast) {
  const pager = document.getElementById(pagerId);
  if (!show) { pager.style.display = "none"; return; }
  pager.style.display = "block";
  document.getElementById(infoId).textContent = info;
  document.getElementById(prevId).disabled = atFirst;
  document.getElementById(nextId).disabled = atLast;
}

// ── machines JSON キャッシュ ──────────────────────────────────────────────
const machinesCache = new Map();

async function fetchMachinesJson(date) {
  if (machinesCache.has(date)) return machinesCache.get(date);
  try {
    const res = await fetch(`data/machines/${date}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    machinesCache.set(date, data);
    return data;
  } catch (_) {
    return null;
  }
}

// ── 日付一覧の管理 ───────────────────────────────────────────────────────
let availableDates = [];

async function loadIndex() {
  try {
    const res = await fetch("data/index.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const idx = await res.json();
    availableDates = idx.dates || [];
  } catch (e) {
    availableDates = [];
  }
}

function populateDateSelect(selectedDate) {
  const input = document.getElementById("date-select");
  if (!availableDates.length) return;
  // min/max で選択可能範囲を限定
  input.min = availableDates[availableDates.length - 1];
  input.max = availableDates[0];
  input.value = selectedDate || availableDates[0];
  updateNavButtons();
}

function updateNavButtons() {
  const input = document.getElementById("date-select");
  const idx = availableDates.indexOf(input.value);
  document.getElementById("btn-prev").disabled = (idx === availableDates.length - 1);
  document.getElementById("btn-next").disabled = (idx <= 0);
}

function stepDate(direction) {
  const input = document.getElementById("date-select");
  const idx = availableDates.indexOf(input.value);
  const nextIdx = idx - direction;
  if (nextIdx < 0 || nextIdx >= availableDates.length) return;
  input.value = availableDates[nextIdx];
  onDateChange();
}

async function onDateChange() {
  const input = document.getElementById("date-select");
  const chosen = input.value;
  // availableDates に含まれない日付は拒否して直前値に戻す
  if (chosen && !availableDates.includes(chosen)) {
    input.value = availableDates[0] || "";
    return;
  }
  updateNavButtons();
  closeStoreDetail();
  await loadAndRender(chosen);
}

// ── データ読み込みと描画 ──────────────────────────────────────────────────
// 現在のデータを保持（ドリルダウンで参照）
let currentData = null;

async function init() {
  await loadIndex();
  const defaultDate = availableDates.length ? availableDates[0] : "";
  populateDateSelect(defaultDate);
  await loadAndRender(defaultDate);
}

async function loadAndRender(selectedDate) {
  const url = selectedDate ? `data/${selectedDate}.json` : "data/latest.json";
  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    document.getElementById("generated-at").textContent =
      "データの読み込みに失敗しました（" + e.message + "）";
    return;
  }
  currentData = data;
  render(data);
}

// ── 描画 ─────────────────────────────────────────────────────────────────
async function render(data) {
  const ts = data.generated_at ? data.generated_at.replace("T", " ") : "不明";
  const playDate = data.play_date || "";
  document.getElementById("generated-at").textContent =
    (playDate ? `対象日: ${playDate}　` : "") + `生成: ${ts}`;

  if (playDate) {
    document.getElementById("top-machines-heading").textContent =
      `出ている機種（${playDate} 基準 直近14日）`;
  }

  // 当日の machines データを先行 fetch して店舗カードの平均差枚に使用
  const machinesData = data.play_date ? await fetchMachinesJson(data.play_date) : null;
  renderStores(data.stores || [], machinesData, data.play_date || "");
  renderDaily(data.daily_summary || []);

  // 機種・店舗ランキングはフロントエンドで直近14日分を集計
  await buildAndRenderTopMachines(data.play_date, data.stores || []);
  await buildAndRenderTopStores(data.play_date, data.stores || []);
}

// ── 店舗カード ────────────────────────────────────────────────────────────
function renderStores(stores, machinesData, displayDate) {
  const container = document.getElementById("stores-container");
  if (!stores.length) {
    container.innerHTML = '<p class="empty">データなし</p>';
    return;
  }
  container.innerHTML = stores.map(s => {
    const hasData = s.machine_count > 0;
    const badge = hasData
      ? `<span class="badge badge-ok">収集済</span>`
      : `<span class="badge badge-ng">未収集</span>`;

    // machines データから当日の平均差枚を計算
    let avgStr = "";
    if (machinesData && machinesData.stores && machinesData.stores[s.store_group]) {
      const machines = machinesData.stores[s.store_group].machines || [];
      const valid = machines.filter(m => m.diff_coins != null);
      if (valid.length > 0) {
        const avg = Math.round(valid.reduce((sum, m) => sum + m.diff_coins, 0) / valid.length);
        const cls = avg >= 0 ? "pos" : "neg";
        avgStr = ` <span class="${cls}">平均: ${avg >= 0 ? "+" : ""}${avg.toLocaleString()}</span>`;
      }
    }

    const storeName = s.store_name.replace(/'/g, "\\'");
    // 表示日のデータを開く（表示日がない場合はその店舗の最新日にフォールバック）
    const cardDate = displayDate || s.latest_date || "";
    return `
      <div class="card" onclick="onCardClick('${s.store_group}', '${storeName}', '${cardDate}')" data-group="${s.store_group}">
        <div class="card-title">${s.store_name}</div>
        <div class="card-value">${s.machine_count.toLocaleString()} 台</div>
        <div class="card-sub">${s.latest_date || "—"} ${badge}${avgStr}</div>
      </div>`;
  }).join("");
}

// ── 店舗カードクリック：ドリルダウン＋当日モーダルを同時に開く ──────────────
function onCardClick(storeGroup, storeName, playDate) {
  openStoreDetail(storeGroup);
  if (playDate) openMachineModal(storeGroup, storeName, playDate);
}

// ── 店舗ドリルダウン ──────────────────────────────────────────────────────
function openStoreDetail(storeGroup) {
  if (!currentData) return;

  // アクティブカードを切り替える
  document.querySelectorAll(".card").forEach(c => c.classList.remove("active"));
  const activeCard = document.querySelector(`.card[data-group="${storeGroup}"]`);
  if (activeCard) activeCard.classList.add("active");

  // 対象店舗情報
  const store = (currentData.stores || []).find(s => s.store_group === storeGroup);
  const storeName = store ? store.store_name : storeGroup;
  const storeIds = store ? store.store_ids : [storeGroup];

  document.getElementById("store-detail-name").textContent = `📊 ${storeName} — 日次サマリ`;

  // daily_summary から対象 store_id のデータを抽出・日付降順
  const summary = (currentData.daily_summary || [])
    .filter(d => storeIds.includes(d.store_id))
    .sort((a, b) => b.play_date.localeCompare(a.play_date));

  const tbody = document.getElementById("store-detail-body");
  if (!summary.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">データなし（過去30日分）</td></tr>';
  } else {
    tbody.innerHTML = summary.map(d => `
      <tr onclick="openMachineModal('${storeGroup}', '${storeName}', '${d.play_date}')" title="クリックで全台リストを表示">
        <td>${fmtDate(d.play_date)}</td>
        <td><span style="font-size:.8rem;color:#888;">${d.store_id}</span></td>
        <td class="num">${d.machine_count.toLocaleString()}</td>
        <td class="num ${diffClass(d.total_diff)}">${fmtDiff(d.total_diff)}</td>
      </tr>`).join("");
  }

  document.getElementById("store-detail").style.display = "block";
  document.getElementById("store-detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeStoreDetail() {
  document.getElementById("store-detail").style.display = "none";
  document.querySelectorAll(".card").forEach(c => c.classList.remove("active"));
}

// ── 機種ランキング ────────────────────────────────────────────────────────

// 直近14日分の日付別 JSON を fetch して機種ランキングをフロントエンドで集計・描画する
async function buildAndRenderTopMachines(playDate, stores) {
  const tbody = document.getElementById("top-machines-body");
  tbody.innerHTML = '<tr><td colspan="7" class="empty">集計中…</td></tr>';

  // 基準日を含む直近14日を availableDates から取得
  const baseIdx = availableDates.indexOf(playDate);
  const targetDates = baseIdx >= 0
    ? availableDates.slice(baseIdx, baseIdx + 14)
    : availableDates.slice(0, 14);

  if (!targetDates.length) {
    renderTopMachines([], stores);
    return;
  }

  // store_group → store_name マップを構築
  const storeMap = {};
  stores.forEach(s => {
    storeMap[s.store_group] = s.store_name;
  });

  // machines/YYYY-MM-DD.json を並行 fetch して台レベルで集計（キャッシュ活用）
  const machineResults = await Promise.all(targetDates.map(d => fetchMachinesJson(d)));

  // 日付 × 店舗 × 機種ごとに集計（1行 = 1日・1店舗・1機種）
  const rows = [];
  machineResults.forEach((data, i) => {
    if (!data) return;
    const playD = targetDates[i];
    Object.entries(data.stores || {}).forEach(([storeGroup, storeData]) => {
      const dayGroups = {};
      (storeData.machines || []).forEach(m => {
        if (m.diff_coins == null) return;
        const name = m.machine_name;
        if (!dayGroups[name]) dayGroups[name] = { totalDiff: 0, plusCount: 0, count: 0 };
        dayGroups[name].totalDiff += m.diff_coins;
        dayGroups[name].count++;
        if (m.diff_coins > 0) dayGroups[name].plusCount++;
      });
      Object.entries(dayGroups).forEach(([machineName, day]) => {
        rows.push({
          store_group: storeGroup,
          machine_name: machineName,
          total_diff: day.totalDiff,
          mean_diff: day.count > 0 ? day.totalDiff / day.count : 0,
          plus_count: day.plusCount,
          total_count: day.count,
          play_date: playD,
        });
      });
    });
  });

  // 平均差枚降順でソート・上位1000件に絞る
  const machines = rows.sort((a, b) => b.mean_diff - a.mean_diff).slice(0, 1000);

  topMachinesAll = machines;
  topMachinesStoreMap = storeMap;
  topMachinesPage = 0;
  renderTopMachines();
}

const TOP_MACHINES_PAGE_SIZE = 100;
let topMachinesAll = [];
let topMachinesStoreMap = {};
let topMachinesPage = 0;

function stepTopMachinesPage(dir) {
  const maxPage = Math.ceil(topMachinesAll.length / TOP_MACHINES_PAGE_SIZE) - 1;
  topMachinesPage = Math.max(0, Math.min(topMachinesPage + dir, maxPage));
  renderTopMachines();
}

function renderTopMachines() {
  const tbody = document.getElementById("top-machines-body");

  if (!topMachinesAll.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">データが蓄積されると表示されます</td></tr>';
    setPagerState("top-machines-pager", null, null, null, false);
    setPagerState("top-machines-pager-bottom", null, null, null, false);
    return;
  }

  const totalPages = Math.ceil(topMachinesAll.length / TOP_MACHINES_PAGE_SIZE);
  const start = topMachinesPage * TOP_MACHINES_PAGE_SIZE;
  const page = topMachinesAll.slice(start, start + TOP_MACHINES_PAGE_SIZE);

  tbody.innerHTML = page.map((m, i) => `
    <tr>
      <td>${start + i + 1}</td>
      <td>${(topMachinesStoreMap && topMachinesStoreMap[m.store_group]) || m.store_group}</td>
      <td>${m.machine_name}</td>
      <td class="num ${diffClass(m.total_diff)}">${fmtDiff(m.total_diff)}</td>
      <td class="num ${diffClass(m.mean_diff)}">${fmtDiff(Math.round(m.mean_diff))}</td>
      <td class="num">${m.plus_count}/${m.total_count}</td>
      <td class="num-date">${fmtDate(m.play_date)}</td>
    </tr>`).join("");

  const show = totalPages > 1;
  const info = `${topMachinesPage + 1} / ${totalPages} ページ（全${topMachinesAll.length}件）`;
  const atFirst = topMachinesPage === 0;
  const atLast = topMachinesPage === totalPages - 1;
  setPagerState("top-machines-pager", "top-machines-page-info", "top-machines-prev", "top-machines-next", show, info, atFirst, atLast);
  setPagerState("top-machines-pager-bottom", "top-machines-page-info-bottom", "top-machines-prev-bottom", "top-machines-next-bottom", show, info, atFirst, atLast);
}

// ── 出ている店舗ランキング ────────────────────────────────────────────────
// machinesCache を再利用（buildAndRenderTopMachines が先に呼ばれている前提）
async function buildAndRenderTopStores(playDate, stores) {
  const tbody = document.getElementById("top-stores-body");
  tbody.innerHTML = '<tr><td colspan="5" class="empty">集計中…</td></tr>';

  const baseIdx = availableDates.indexOf(playDate);
  const targetDates = baseIdx >= 0
    ? availableDates.slice(baseIdx, baseIdx + 14)
    : availableDates.slice(0, 14);

  if (!targetDates.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">データが蓄積されると表示されます</td></tr>';
    return;
  }

  const storeMap = {};
  stores.forEach(s => { storeMap[s.store_group] = s.store_name; });

  // 各日の machines JSON を fetch（buildAndRenderTopMachines 後なのでほぼキャッシュヒット）
  const machineResults = await Promise.all(targetDates.map(d => fetchMachinesJson(d)));

  // 日付 × 店舗ごとに差枚集計
  const rows = [];
  machineResults.forEach((data, i) => {
    if (!data) return;
    const playD = targetDates[i];
    Object.entries(data.stores || {}).forEach(([storeGroup, storeData]) => {
      const machines = (storeData.machines || []).filter(m => m.diff_coins != null);
      if (!machines.length) return;
      const totalDiff = machines.reduce((s, m) => s + m.diff_coins, 0);
      const avgDiff = Math.round(totalDiff / machines.length);
      rows.push({ store_group: storeGroup, total_diff: totalDiff, avg_diff: avgDiff, play_date: playD });
    });
  });

  // 平均差枚降順でソート・上位100件
  rows.sort((a, b) => b.avg_diff - a.avg_diff);
  const top = rows.slice(0, 100);

  if (!top.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">データが蓄積されると表示されます</td></tr>';
    return;
  }

  tbody.innerHTML = top.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${storeMap[r.store_group] || r.store_group}</td>
      <td class="num ${diffClass(r.total_diff)}">${fmtDiff(r.total_diff)}</td>
      <td class="num ${diffClass(r.avg_diff)}">${fmtDiff(r.avg_diff)}</td>
      <td class="num-date">${fmtDate(r.play_date)}</td>
    </tr>`).join("");
}

// ── 全台リストモーダル ────────────────────────────────────────────────────
// 現在モーダルに表示中の台データ（ソート用に保持）
let currentMachines = [];
// 台番末尾フィルタ（null = フィルタなし, { type: "suffix1"|"zoromi", value: string }）
let machineNumberFilter = null;

function setMachineNumFilter(type, value) {
  machineNumberFilter = { type, value };
  const key = type === "suffix1" ? `s${value}` : `z${value}`;
  document.querySelectorAll("#machine-number-filter-bar .filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.nf === key);
  });
  renderMachineTable();
}

function clearMachineNumFilter() {
  machineNumberFilter = null;
  document.querySelectorAll("#machine-number-filter-bar .filter-btn").forEach(btn => {
    btn.classList.remove("active");
  });
  renderMachineTable();
}

function applyMachineNumberFilter(machines) {
  if (!machineNumberFilter) return machines;
  const { value } = machineNumberFilter;
  return machines.filter(m => String(m.machine_number ?? "").endsWith(value));
}
let modelSummaryCache = null;  // currentMachines が変わるまで使い回す
let modalSortCol = "diff_coins";
let modalSortAsc = false;  // デフォルト：差枚降順

async function openMachineModal(storeGroup, storeName, playDate) {
  document.getElementById("machine-modal-title").textContent =
    `📋 ${storeName} — ${fmtDateText(playDate)} 全台リスト`;
  document.getElementById("machine-table-body").innerHTML =
    '<tr><td colspan="6" class="empty">読み込み中…</td></tr>';
  document.getElementById("machine-modal-overlay").classList.add("open");

  // machines/YYYY-MM-DD.json を fetch（キャッシュ活用）
  const machinesData = await fetchMachinesJson(playDate);
  if (!machinesData) {
    document.getElementById("machine-table-body").innerHTML =
      '<tr><td colspan="7" class="empty">データ取得失敗</td></tr>';
    return;
  }

  // storeGroup に対応する machines を取得
  const storeEntry = machinesData.stores ? machinesData.stores[storeGroup] : null;
  currentMachines = storeEntry ? (storeEntry.machines || []) : [];
  modelSummaryCache = null;

  // ヘッダーにソース情報を付加（全台同一ソースの前提で先頭1件を参照）
  const sourceId = currentMachines[0]?.source_id ?? null;
  const sourceLabel = sourceId ? `　${sourceId}` : "";
  document.getElementById("machine-modal-title").textContent =
    `📋 ${storeName} — ${fmtDateText(playDate)} 全台リスト${sourceLabel}`;

  // デフォルト：全台リストタブ・差枚降順・フィルタなし
  resetFilterUI();
  switchModalTab("all");
  modalSortCol = "diff_coins";
  modalSortAsc = false;
  renderMachineTable();
}

function resetFilterUI() {
  machineFilter = null;
  document.getElementById("tab-btn-all").textContent = "全台リスト";
  document.getElementById("show-all-btn").style.display = "none";
}

function closeMachineModal() {
  document.getElementById("machine-modal-overlay").classList.remove("open");
  currentMachines = [];
  resetFilterUI();
  clearMachineNumFilter();
}

function onModalOverlayClick(e) {
  // オーバーレイ背景クリック時のみ閉じる（モーダル内クリックは閉じない）
  if (e.target === document.getElementById("machine-modal-overlay")) {
    closeMachineModal();
  }
}

function renderMachineTable() {
  const tbody = document.getElementById("machine-table-body");

  // 機種名フィルタ → 台番末尾フィルタの順で絞り込む
  const byModel = machineFilter
    ? currentMachines.filter(m => m.machine_name === machineFilter)
    : currentMachines;
  const source = applyMachineNumberFilter(byModel);

  if (!source.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">この日のデータなし</td></tr>';
    return;
  }

  // ソート処理
  const sorted = [...source].sort((a, b) => {
    let va = a[modalSortCol];
    let vb = b[modalSortCol];

    // 台番は数値ソート
    if (modalSortCol === "machine_number") {
      va = parseInt(va, 10) || 0;
      vb = parseInt(vb, 10) || 0;
    }
    // null は末尾
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;

    if (va < vb) return modalSortAsc ? -1 : 1;
    if (va > vb) return modalSortAsc ? 1 : -1;
    return 0;
  });

  tbody.innerHTML = sorted.map(m => {
    const bbStr = m.bb_prob != null ? `1/${m.bb_prob.toFixed(1)}` : "—";
    const rbStr = m.rb_prob != null ? `1/${m.rb_prob.toFixed(1)}` : "—";
    return `
      <tr>
        <td>${m.machine_number ?? "—"}</td>
        <td>${m.machine_name ?? "—"}</td>
        <td class="num ${diffClass(m.diff_coins)}">${fmtDiff(m.diff_coins)}</td>
        <td class="num">${m.total_games != null ? m.total_games.toLocaleString() : "—"}</td>
        <td class="num">${bbStr}</td>
        <td class="num">${rbStr}</td>
      </tr>`;
  }).join("");

  updateSortIndicators("machine-table", modalSortCol, modalSortAsc);
}

// ── タブ切替 ──────────────────────────────────────────────────────────────
function switchModalTab(tab) {
  document.querySelectorAll(".modal-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.getElementById("tab-all").style.display   = tab === "all"   ? "" : "none";
  document.getElementById("tab-model").style.display = tab === "model" ? "" : "none";

  if (tab === "all") {
    renderMachineTable();
  } else if (tab === "model") {
    modelSortCol = "total_diff";
    modelSortAsc = false;
    renderModelTable();
  }
}

// machineFilter をリセットして全台リストに戻る
function resetMachineFilter() {
  resetFilterUI();
  switchModalTab("all");
}

// ── 機種別サマリタブ ──────────────────────────────────────────────────────
let modelSortCol = "total_diff";
let modelSortAsc = false;

function buildModelSummary(machines) {
  // 機種名でグルーピングして集計
  const groups = {};
  machines.forEach(m => {
    const name = m.machine_name ?? "不明";
    if (!groups[name]) groups[name] = { diffs: [], count: 0 };
    groups[name].diffs.push(m.diff_coins ?? 0);
    groups[name].count++;
  });

  return Object.entries(groups).map(([name, g]) => {
    const total = g.diffs.reduce((s, v) => s + v, 0);
    const avg   = g.count > 0 ? Math.round(total / g.count) : 0;
    const wins  = g.diffs.filter(v => v > 0).length;
    return {
      machine_name: name,
      total_diff:   total,
      avg_diff:     avg,
      win_count:    wins,
      count:        g.count,
      // ソート用キー
      win_rate:     g.count > 0 ? wins / g.count : 0,
    };
  });
}

function renderModelTable(filterName = null) {
  const tbody = document.getElementById("model-table-body");

  if (!currentMachines.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">この日のデータなし</td></tr>';
    return;
  }

  if (!modelSummaryCache) modelSummaryCache = buildModelSummary(currentMachines);
  let summary = modelSummaryCache;

  // 機種名絞り込み（機種行クリックからの戻り表示には使わないが将来拡張用）
  if (filterName) summary = summary.filter(s => s.machine_name === filterName);

  // ソート
  summary.sort((a, b) => {
    let va = a[modelSortCol];
    let vb = b[modelSortCol];
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === "string") return modelSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    return modelSortAsc ? va - vb : vb - va;
  });

  tbody.innerHTML = summary.map(s => `
    <tr onclick="openModelDetail('${s.machine_name.replace(/'/g, "\\'")}')" title="クリックで台リストを絞り込み">
      <td>${s.machine_name}</td>
      <td class="num ${diffClass(s.total_diff)}">${fmtDiff(s.total_diff)}</td>
      <td class="num ${diffClass(s.avg_diff)}">${fmtDiff(s.avg_diff)}</td>
      <td class="num">${s.win_count}/${s.count}</td>
      <td class="num">${s.count}</td>
    </tr>`).join("");

  updateSortIndicators("model-table", modelSortCol, modelSortAsc);
}

// ── 機種行クリック → 全台リストを機種名で絞り込み ────────────────────────
// 絞り込み中の機種名（null = 絞り込みなし）
let machineFilter = null;

function openModelDetail(machineName) {
  machineFilter = machineName;

  // タブ名を機種名に変更し「全台リストを表示」ボタンを表示
  document.getElementById("tab-btn-all").textContent = machineName;
  document.getElementById("show-all-btn").style.display = "";

  // 全台リストタブに切り替え・差枚降順で表示
  modalSortCol = "diff_coins";
  modalSortAsc = false;
  switchModalTab("all");
}

// ── 日次サマリ ────────────────────────────────────────────────────────────
function toggleDailySummary() {
  const body = document.getElementById("daily-summary-body");
  const arrow = document.getElementById("daily-summary-toggle");
  const isOpen = body.style.display !== "none";
  body.style.display = isOpen ? "none" : "";
  arrow.textContent = isOpen ? "▶" : "▼";
}

// 現在のフィルタ状態（type: "all" | "digit" | "zoromi" | "tsuki_zoromi" | "weekday", value: 任意）
let dailyFilter = { type: "all", value: null };

function setDailyFilter(type, value = null) {
  dailyFilter = { type, value };

  // アクティブボタンを更新
  const filterKey = type === "digit" ? `digit-${value}`
    : type === "weekday" ? `wd-${value}`
    : type;
  document.querySelectorAll("#daily-filter-bar .filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === filterKey);
  });

  // 再描画
  if (currentData) renderDaily(currentData.daily_summary || []);
}

function filterDailySummary(summary) {
  const { type, value } = dailyFilter;
  if (type === "all") return summary;
  return summary.filter(d => {
    const dt = new Date(d.play_date + "T00:00:00");
    const day = dt.getDate();
    const month = dt.getMonth() + 1;
    const wd = dt.getDay();
    if (type === "digit") {
      // 日付の1桁目（1の位または10の位）に value が含まれる
      return String(day).includes(String(value));
    }
    if (type === "zoromi") return day === 11 || day === 22;
    if (type === "tsuki_zoromi") return month === day;
    if (type === "weekday") return wd === Number(value);
    return true;
  });
}

function renderDaily(summary) {
  const tbody = document.getElementById("daily-body");
  if (!summary.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">データなし</td></tr>';
    return;
  }

  // store_id → store_name を currentData.stores から引く
  const storeMap = {};
  if (currentData && currentData.stores) {
    currentData.stores.forEach(s => {
      s.store_ids.forEach(sid => { storeMap[sid] = s.store_name; });
    });
  }

  const filtered = filterDailySummary(summary);
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">該当するデータなし</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(d => {
    const avg = (d.total_diff != null && d.machine_count > 0)
      ? Math.round(d.total_diff / d.machine_count) : null;
    return `
    <tr>
      <td>${fmtDate(d.play_date)}</td>
      <td>${storeMap[d.store_id] || d.store_id}</td>
      <td class="num">${d.machine_count.toLocaleString()}</td>
      <td class="num ${diffClass(d.total_diff)}">${fmtDiff(d.total_diff)}</td>
      <td class="num ${diffClass(avg)}">${fmtDiff(avg)}</td>
    </tr>`;
  }).join("");
}