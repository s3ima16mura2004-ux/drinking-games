/* ==========================================================
   king-game-draw.js
   画面3: くじ引き結果 + 王様の命令フォーム
   (カテゴリ選択・検索・ルーレット・投票・対象者選択・送信)
   ========================================================== */

/* ==========================================================
   画面3: くじ引き結果 + 王様の命令フォーム
   ========================================================== */
function enterDrawScreen(room) {
  showScreen("screen-draw");
  const card = $("draw-card");
  card.classList.remove("is-flipped");
  card.classList.add("is-shuffling");
  $("draw-king-badge").hidden = true;
  $("king-command-panel").hidden = true;
  $("draw-wait-note").hidden = false;
  $("draw-wait-note").textContent = "くじをシャッフルしています…";
  $("draw-thinking-note").hidden = true;
  $("vote-panel").hidden = true;

  currentTemplateIndex = null;
  selectedCategoryIndex = null;
  stopRoulette();
  state.appliedResolvedVoteIndex = null;
  setKingMode("manual");
  $("template-picker-section").hidden = false;
  $("category-chips").querySelectorAll(".category-chip").forEach((b) => {
    b.classList.remove("is-active");
    b.setAttribute("aria-pressed", "false");
  });
  $("btn-roulette-category").hidden = true;
  $("roulette-display").hidden = true;
  $("template-item-list").innerHTML = "";
  $("template-search").value = "";
  $("save-as-template-row").hidden = false;
  $("save-as-template-check").checked = false;
  $("target-select-block").hidden = true;
  $("btn-reroll").hidden = true;
  $("command-text").value = "";

  let minTimePassed = false;
  let numberData = null;

  setTimeout(() => {
    minTimePassed = true;
    tryReveal();
  }, MIN_SHUFFLE_MS);

  function tryReveal() {
    if (!minTimePassed || !numberData) return;

    state.myNumber = numberData.number;
    $("draw-number").textContent = numberData.number;
    card.classList.remove("is-shuffling");
    card.classList.add("is-flipped");
    $("draw-wait-note").hidden = true;

    const amKing = room.kingUid === state.uid;
    $("draw-king-badge").hidden = !amKing;

    if (amKing) {
      setupKingPanel();
      if (room.lastWeakVoteCount && state.weakHintShownRound !== room.round) {
        state.weakHintShownRound = room.round;
        showErrorBanner(
          `前回は${room.lastWeakVoteCount}人が「ちょっと弱いかも」と感じたようです。今回は一工夫してみましょう。`,
          true
        );
      }
    } else {
      $("draw-thinking-note").hidden = false;
    }
  }

  if (state.unsubMe) state.unsubMe();
  const meRef = db.collection("rooms").doc(state.roomId).collection("players").doc(state.uid);

  state.unsubMe = meRef.onSnapshot(
    (doc) => {
      const data = doc.data();
      if (!data || data.number == null) return;
      numberData = data;
      tryReveal();
    },
    (err) => {
      console.error(err);
      showErrorBanner(friendlyErrorMessage(err));
    }
  );
}

let currentTemplateIndex = null;
let selectedCategoryIndex = null;

/* ---------- 命令の決め方: 自分で選ぶ / みんなで投票する ---------- */
function setKingMode(mode) {
  const manualActive = mode === "manual";
  $("btn-mode-manual").classList.toggle("is-active", manualActive);
  $("btn-mode-manual").setAttribute("aria-pressed", manualActive ? "true" : "false");
  $("btn-mode-vote").classList.toggle("is-active", !manualActive);
  $("btn-mode-vote").setAttribute("aria-pressed", !manualActive ? "true" : "false");
  $("manual-template-block").hidden = mode === "vote";
}

$("btn-mode-manual").addEventListener("click", async () => {
  setKingMode("manual");
  $("template-picker-section").hidden = false;
  state.appliedResolvedVoteIndex = null;
  // 投票を進行中にやめる場合は、投票データをクリアする
  try {
    await db.collection("rooms").doc(state.roomId).update({
      votingOpen: false,
      voteOptions: [],
      votes: {},
      voteResolvedIndex: null
    });
  } catch (err) {
    console.error(err);
  }
});

$("btn-mode-vote").addEventListener("click", () => {
  setKingMode("vote");
  state.appliedResolvedVoteIndex = null;
  startVoting();
});

async function startVoting() {
  if (!state.roomId) return;
  const excludedCats = state.excludedCategories || [];
  const allowedIndices = COMMAND_TEMPLATES_FLAT
    .map((_, i) => i)
    .filter((idx) => !isTextNgFiltered(COMMAND_TEMPLATES_FLAT[idx].text))
    .filter((idx) => {
      const catIdx = categoryIndexOfTemplate(idx);
      return catIdx === -1 || !excludedCats.includes(COMMAND_CATEGORIES[catIdx].label);
    });
  const pool = allowedIndices.length ? allowedIndices : COMMAND_TEMPLATES_FLAT.map((_, i) => i);
  const count = Math.min(3, pool.length);
  const indices = shuffle(pool).slice(0, count);
  try {
    await db.collection("rooms").doc(state.roomId).update({
      votingOpen: true,
      voteOptions: indices,
      votes: {},
      voteResolvedIndex: null
    });
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  }
}

$("btn-cancel-vote").addEventListener("click", async () => {
  try {
    await db.collection("rooms").doc(state.roomId).update({
      votingOpen: false,
      voteOptions: [],
      votes: {},
      voteResolvedIndex: null
    });
    state.appliedResolvedVoteIndex = null;
    setKingMode("manual");
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  }
});

$("btn-close-vote").addEventListener("click", async () => {
  $("btn-close-vote").disabled = true;
  try {
    const roomRef = db.collection("rooms").doc(state.roomId);
    const snap = await roomRef.get();
    const room = snap.data();
    const voteOptions = room.voteOptions || [];
    const votes = room.votes || {};
    if (!voteOptions.length) return;

    const counts = voteOptions.map((_, idx) =>
      Object.values(votes).filter((v) => v === idx).length
    );
    const maxCount = Math.max(...counts);
    const winners = counts
      .map((c, idx) => (c === maxCount ? idx : -1))
      .filter((idx) => idx !== -1);
    const winnerLocalIdx = winners[Math.floor(Math.random() * winners.length)];
    const winnerTemplateIdx = voteOptions[winnerLocalIdx];

    await roomRef.update({
      votingOpen: false,
      voteResolvedIndex: winnerTemplateIdx
    });
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  } finally {
    $("btn-close-vote").disabled = false;
  }
});

// 投票結果に応じて対象者選択の画面を作る(手動選択時と同じ流れに合流させる)
function applyResolvedTemplateForKing(tplIdx) {
  $("king-command-panel").hidden = false;
  setKingMode("manual");
  $("template-picker-section").hidden = true; // カテゴリ選びのUIだけ隠し、対象者選択は見せる
  const catIdx = categoryIndexOfTemplate(tplIdx);
  if (catIdx !== -1) selectCategory(catIdx);
  selectTemplateByIndex(tplIdx);
  showErrorBanner("投票で命令テーマが決まりました。対象者を確認して発表してください。", true);
}

// 部屋ドキュメントの更新のたびに(くじの再演出はせず)投票パネルなどを同期する
function syncDrawExtras(room) {
  const amKing = room.kingUid === state.uid;
  const votingOpen = !!room.votingOpen;
  const voteOptions = room.voteOptions || [];
  const votes = room.votes || {};

  if (votingOpen && voteOptions.length) {
    renderVotePanel(amKing, voteOptions, votes);
    $("vote-panel").hidden = false;
    if (amKing) $("king-command-panel").hidden = true;
  } else {
    $("vote-panel").hidden = true;
    if (amKing && room.voteResolvedIndex != null
        && state.appliedResolvedVoteIndex !== room.voteResolvedIndex) {
      state.appliedResolvedVoteIndex = room.voteResolvedIndex;
      applyResolvedTemplateForKing(room.voteResolvedIndex);
    }
  }
}

function renderVotePanel(amKing, voteOptions, votes) {
  const list = $("vote-options-list");
  const counts = voteOptions.map((_, idx) =>
    Object.values(votes).filter((v) => v === idx).length
  );
  const myVote = votes[state.uid];

  list.innerHTML = voteOptions
    .map((tplIdx, idx) => {
      const tpl = COMMAND_TEMPLATES_FLAT[tplIdx];
      const label = tpl ? tpl.text.replace("{A}", "◯").replace("{B}", "△") : "";
      const mineClass = myVote === idx ? " is-mine" : "";
      return `<li><button type="button" class="vote-option-btn${mineClass}" data-idx="${idx}" aria-pressed="${myVote === idx ? "true" : "false"}">
        <span>${escapeHtml(label)}</span><span class="vote-option-count">${counts[idx]}票</span>
      </button></li>`;
    })
    .join("");

  list.querySelectorAll(".vote-option-btn").forEach((btn) => {
    btn.onclick = () => castVote(Number(btn.dataset.idx));
  });

  $("vote-king-controls").hidden = !amKing;
  $("vote-guest-note").hidden = amKing;
}

async function castVote(idx) {
  if (!state.roomId || !state.uid) return;
  try {
    await db.collection("rooms").doc(state.roomId).update({
      [`votes.${state.uid}`]: idx
    });
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  }
}

function setupKingPanel() {
  $("king-command-panel").hidden = false;

  const helpBtn = $("btn-king-help");
  if (helpBtn.dataset.wired !== "1") {
    helpBtn.addEventListener("click", () => {
      $("king-help-box").hidden = !$("king-help-box").hidden;
    });
    $("btn-close-king-help").addEventListener("click", () => {
      $("king-help-box").hidden = true;
    });
    helpBtn.dataset.wired = "1";
  }
  // 初めて王様になった時だけ、使い方を自動で開いておく
  if (localStorage.getItem("kg_seenKingHelp") !== "1") {
    $("king-help-box").hidden = false;
    localStorage.setItem("kg_seenKingHelp", "1");
  }

  renderCategoryChips();

  const searchInput = $("template-search");
  if (searchInput.dataset.wired !== "1") {
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim();
      $("category-chips").querySelectorAll(".category-chip:not(.custom-chip)").forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-pressed", "false");
      });
      $("custom-template-chip").classList.remove("is-active");
      if (q) {
        renderTemplateSearchResults(q);
      } else if (selectedCategoryIndex != null) {
        renderTemplateItemList(selectedCategoryIndex);
      } else {
        $("template-item-list").innerHTML = "";
      }
    });
    searchInput.dataset.wired = "1";
  }

  const customChip = $("custom-template-chip");
  if (customChip.dataset.wired !== "1") {
    customChip.addEventListener("click", () => {
      selectedCategoryIndex = null;
      $("template-search").value = "";
      $("category-chips").querySelectorAll(".category-chip").forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-pressed", "false");
      });
      customChip.classList.add("is-active");
      customChip.setAttribute("aria-pressed", "true");
      $("btn-roulette-category").hidden = true;
      renderCustomTemplateItemList();
    });
    customChip.dataset.wired = "1";
  }

  renderDrawHistoryReuseList();

  $("btn-reroll").onclick = () => rerollTargets();
  $("target-a-select").onchange = () => {
    populateTargetSelects(COMMAND_TEMPLATES_FLAT[currentTemplateIndex], { keepA: true });
    renderCommandFromTargets();
  };
  $("target-b-select").onchange = () => renderCommandFromTargets();
}

/* ---------- お題選択: カテゴリチップ → タップ式の一覧 ---------- */
function renderCategoryChips() {
  const wrap = $("category-chips");
  const excluded = state.excludedCategories || [];
  wrap.innerHTML = COMMAND_CATEGORIES
    .map((cat, i) => ({ cat, i }))
    .filter(({ cat }) => !excluded.includes(cat.label))
    .map(({ cat, i }) => `<button type="button" class="category-chip" data-cat="${i}" aria-pressed="false">${escapeHtml(cat.label)}</button>`)
    .join("");
  wrap.querySelectorAll(".category-chip").forEach((btn) => {
    btn.addEventListener("click", () => selectCategory(Number(btn.dataset.cat)));
  });
}

function selectCategory(catIndex) {
  selectedCategoryIndex = catIndex;
  $("template-search").value = "";
  $("category-chips").querySelectorAll(".category-chip").forEach((btn, i) => {
    const active = i === catIndex;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const customChip = $("custom-template-chip");
  customChip.classList.remove("is-active");
  customChip.setAttribute("aria-pressed", "false");
  $("btn-roulette-category").hidden = false;
  renderTemplateItemList(catIndex);
}

// NGワードに一致するお題を除外する(今夜のローカルルールで設定されたもの)
function isTextNgFiltered(text) {
  const keywords = state.bannedKeywords || [];
  if (!keywords.length) return false;
  const lower = text.toLowerCase();
  return keywords.some((w) => w && lower.includes(w.toLowerCase()));
}

function renderTemplateItemList(catIndex) {
  const cat = COMMAND_CATEGORIES[catIndex];
  const indices = cat.items
    .map((item) => COMMAND_TEMPLATES_FLAT.indexOf(item))
    .filter((idx) => !isTextNgFiltered(COMMAND_TEMPLATES_FLAT[idx].text));
  if (!indices.length) {
    $("template-item-list").innerHTML = '<li class="template-empty-hint">このカテゴリのお題はNGワードに一致しているため表示できません</li>';
    return;
  }
  $("template-item-list").innerHTML = buildTemplateItemsHtml(indices);
  wireTemplateItemButtons();
}

// キーワード検索(全カテゴリ横断)。マッチした項目にはカテゴリ名のタグを添える
function renderTemplateSearchResults(query) {
  const q = query.toLowerCase();
  const excludedCats = state.excludedCategories || [];
  const indices = COMMAND_TEMPLATES_FLAT
    .map((_, idx) => idx)
    .filter((idx) => !isTextNgFiltered(COMMAND_TEMPLATES_FLAT[idx].text))
    .filter((idx) => {
      const catIdx = categoryIndexOfTemplate(idx);
      return catIdx === -1 || !excludedCats.includes(COMMAND_CATEGORIES[catIdx].label);
    })
    .filter((idx) => COMMAND_TEMPLATES_FLAT[idx].text.replace("{A}", "◯").replace("{B}", "△").toLowerCase().includes(q));

  const list = $("template-item-list");
  if (!indices.length) {
    list.innerHTML = '<li class="template-empty-hint">一致するお題が見つかりませんでした</li>';
    return;
  }
  list.innerHTML = buildTemplateItemsHtml(indices, { showCategory: true });
  wireTemplateItemButtons();
}

function buildTemplateItemsHtml(indices, opts) {
  opts = opts || {};
  return indices
    .map((flatIdx) => {
      const item = COMMAND_TEMPLATES_FLAT[flatIdx];
      const label = item.text.replace("{A}", "◯").replace("{B}", "△");
      const isActive = currentTemplateIndex === flatIdx;
      let catTag = "";
      if (opts.showCategory) {
        const catIdx = categoryIndexOfTemplate(flatIdx);
        if (catIdx !== -1) catTag = `<span class="template-item-cat">${escapeHtml(COMMAND_CATEGORIES[catIdx].label)}</span>`;
      }
      return `<li><button type="button" class="template-item-btn${isActive ? " is-active" : ""}" data-idx="${flatIdx}" aria-pressed="${isActive ? "true" : "false"}">${catTag}${escapeHtml(label)}</button></li>`;
    })
    .join("");
}

function wireTemplateItemButtons() {
  $("template-item-list").querySelectorAll(".template-item-btn[data-idx]").forEach((btn) => {
    btn.addEventListener("click", () => selectTemplateByIndex(Number(btn.dataset.idx)));
  });
}

// この部屋だけのオリジナルお題(自由入力から保存されたもの)の一覧
function renderCustomTemplateItemList() {
  const list = $("template-item-list");
  const items = (state.customTemplates || []).filter((item) => !isTextNgFiltered(item.text));
  if (!items.length) {
    list.innerHTML = '<li class="template-empty-hint">まだこの部屋のオリジナルお題はありません</li>';
    return;
  }
  list.innerHTML = items
    .map((item) => `<li><button type="button" class="template-item-btn" data-custom-id="${item.id}" aria-pressed="false">${escapeHtml(item.text)}</button></li>`)
    .join("");
  list.querySelectorAll(".template-item-btn[data-custom-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentTemplateIndex = null;
      $("target-select-block").hidden = true;
      $("btn-reroll").hidden = true;
      $("save-as-template-row").hidden = false;
      const item = (state.customTemplates || []).find((c) => c.id === btn.dataset.customId);
      $("command-text").value = item ? item.text : "";
      list.querySelectorAll(".template-item-btn[data-custom-id]").forEach((b) => {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
    });
  });
}

// ラウンド履歴から「もう一度使う」(テンプレート由来の命令のみ再利用できる)
function renderDrawHistoryReuseList() {
  const panel = $("draw-history-panel");
  const list = $("draw-history-list");
  if (!panel || !list) return;
  const items = (state.historyItems || []).filter((item) => item.templateIndex != null);
  panel.hidden = items.length === 0;
  list.innerHTML = items
    .map(
      (item) => `<li><span class="history-round-badge">第${item.round}幕</span>${escapeHtml(item.command)}
        <span class="history-king-name">王様: ${escapeHtml(item.kingName || "")}</span>
        <button type="button" class="btn btn-ghost btn-small history-reuse-btn" data-tpl="${item.templateIndex}">もう一度使う</button></li>`
    )
    .join("");
  list.querySelectorAll(".history-reuse-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.tpl);
      const catIdx = categoryIndexOfTemplate(idx);
      if (catIdx !== -1) selectCategory(catIdx);
      selectTemplateByIndex(idx);
    });
  });
}

// お題を確定させる(カテゴリ一覧タップ・検索・ルーレット・投票結果・履歴再利用、すべてここに合流する)
function selectTemplateByIndex(idx) {
  currentTemplateIndex = idx;
  const tpl = COMMAND_TEMPLATES_FLAT[idx];
  const nums = pickUniqueNumbers(tpl.slots, state.playerCount || 3, state.myNumber);

  populateTargetSelects(tpl);
  $("target-a-select").value = nums[0];
  if (tpl.slots === 2) {
    populateTargetSelects(tpl, { keepA: true });
    $("target-b-select").value = nums[1];
  }

  $("target-select-block").hidden = false;
  $("btn-reroll").hidden = false;
  $("save-as-template-row").hidden = true; // 既存テンプレ由来の命令は保存対象外
  renderCommandFromTargets();

  $("template-item-list").querySelectorAll(".template-item-btn[data-idx]").forEach((btn) => {
    const active = Number(btn.dataset.idx) === idx;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function categoryIndexOfTemplate(flatIdx) {
  const item = COMMAND_TEMPLATES_FLAT[flatIdx];
  return COMMAND_CATEGORIES.findIndex((cat) => cat.items.includes(item));
}

/* ---------- ルーレット(スロット風のランダム選択) ---------- */
let rouletteTimer = null;

function stopRoulette() {
  if (rouletteTimer) {
    clearTimeout(rouletteTimer);
    rouletteTimer = null;
  }
}

function runRoulette(displayPool, pickPool) {
  if (!displayPool || !displayPool.length) return;
  const finalPool = pickPool && pickPool.length ? pickPool : displayPool;
  stopRoulette();

  const display = $("roulette-display");
  display.hidden = false;
  display.classList.remove("is-landing");
  $("btn-roulette-all").disabled = true;
  $("btn-roulette-category").disabled = true;

  const TOTAL_STEPS = 18;
  const finalIdx = finalPool[Math.floor(Math.random() * finalPool.length)];
  let step = 0;

  function renderStep(idx) {
    const tpl = COMMAND_TEMPLATES_FLAT[idx];
    display.textContent = `🎲 ${tpl.text.replace("{A}", "◯").replace("{B}", "△")}`;
  }

  function tick() {
    step++;
    const isLast = step >= TOTAL_STEPS;
    renderStep(isLast ? finalIdx : displayPool[Math.floor(Math.random() * displayPool.length)]);

    if (!isLast) {
      // だんだん間隔をあけて、スロットが止まる感じを出す
      const delay = 40 + Math.round(Math.pow(step / TOTAL_STEPS, 2) * 260);
      rouletteTimer = setTimeout(tick, delay);
      return;
    }

    display.classList.add("is-landing");
    $("btn-roulette-all").disabled = false;
    $("btn-roulette-category").disabled = false;
    playCommandRevealEffect();

    const catIdx = categoryIndexOfTemplate(finalIdx);
    if (catIdx !== -1) selectCategory(catIdx);
    selectTemplateByIndex(finalIdx);

    setTimeout(() => { display.hidden = true; }, 1400);
  }

  tick();
}

// 直近2ラウンドで使ったばかりのお題を候補から除外する(全滅する場合は元のプールにフォールバック)
function excludingRecentlyUsed(pool) {
  const recent = state.recentTemplateIndices || [];
  const filtered = pool.filter((idx) => !recent.includes(idx));
  return filtered.length ? filtered : pool;
}

// NGワードに一致するお題をプールから除外する(全滅する場合は元のプールにフォールバック)
function excludingNgWords(pool) {
  const excludedCats = state.excludedCategories || [];
  const filtered = pool.filter((idx) => {
    if (isTextNgFiltered(COMMAND_TEMPLATES_FLAT[idx].text)) return false;
    const catIdx = categoryIndexOfTemplate(idx);
    return catIdx === -1 || !excludedCats.includes(COMMAND_CATEGORIES[catIdx].label);
  });
  return filtered.length ? filtered : pool;
}

$("btn-roulette-all").addEventListener("click", () => {
  const all = excludingNgWords(COMMAND_TEMPLATES_FLAT.map((_, i) => i));
  runRoulette(all, excludingRecentlyUsed(all));
});

$("btn-roulette-category").addEventListener("click", () => {
  if (selectedCategoryIndex == null) return;
  const pool = excludingNgWords(
    COMMAND_CATEGORIES[selectedCategoryIndex].items.map((item) => COMMAND_TEMPLATES_FLAT.indexOf(item))
  );
  runRoulette(pool, excludingRecentlyUsed(pool));
});

// 対象①・対象②のプルダウンを、参加人数(王様自身を除く)に合わせて作り直す
function populateTargetSelects(tpl, opts) {
  opts = opts || {};
  const allCandidates = Array.from({ length: state.playerCount || 3 }, (_, i) => i + 1)
    .filter((n) => n !== state.myNumber);

  const selectA = $("target-a-select");
  const prevA = selectA.value;
  selectA.innerHTML = allCandidates.map((n) => `<option value="${n}">${n}番</option>`).join("");
  if (opts.keepA && allCandidates.map(String).includes(prevA)) {
    selectA.value = prevA;
  }

  if (tpl.slots === 2) {
    $("target-b-block").hidden = false;
    const selectB = $("target-b-select");
    const prevB = selectB.value;
    const bCandidates = allCandidates.filter((n) => String(n) !== selectA.value);
    selectB.innerHTML = bCandidates.map((n) => `<option value="${n}">${n}番</option>`).join("");
    if (bCandidates.map(String).includes(prevB)) {
      selectB.value = prevB;
    }
  } else {
    $("target-b-block").hidden = true;
  }
}

function renderCommandFromTargets() {
  const tpl = COMMAND_TEMPLATES_FLAT[currentTemplateIndex];
  if (!tpl) return;
  const a = $("target-a-select").value;
  const b = $("target-b-select").value;

  let text = tpl.text.replace("{A}", a);
  if (tpl.slots === 2) text = text.replace("{B}", b);
  $("command-text").value = text;
}

function rerollTargets() {
  if (currentTemplateIndex == null) return;
  const tpl = COMMAND_TEMPLATES_FLAT[currentTemplateIndex];
  const nums = pickUniqueNumbers(tpl.slots, state.playerCount || 3, state.myNumber);

  populateTargetSelects(tpl);
  $("target-a-select").value = nums[0];
  if (tpl.slots === 2) {
    populateTargetSelects(tpl, { keepA: true });
    $("target-b-select").value = nums[1];
  }
  renderCommandFromTargets();
}

$("btn-send-command").addEventListener("click", async () => {
  const text = $("command-text").value.trim();
  if (!text) return;
  if (!confirm(`この命令を全員に発表します。よろしいですか?\n\n「${text}」`)) return;
  $("btn-send-command").disabled = true;

  try {
    const roomRef = db.collection("rooms").doc(state.roomId);

    // テンプレート由来の場合のみ、対象者番号がわかるので免除カードの対象判定に使う
    const targetNumbers = [];
    if (currentTemplateIndex != null) {
      const tpl = COMMAND_TEMPLATES_FLAT[currentTemplateIndex];
      const a = parseInt($("target-a-select").value, 10);
      if (!isNaN(a)) targetNumbers.push(a);
      if (tpl.slots === 2) {
        const b = parseInt($("target-b-select").value, 10);
        if (!isNaN(b)) targetNumbers.push(b);
      }
    }

    await roomRef.update({
      status: "command",
      currentCommand: text,
      targetNumbers,
      exemptedThisRound: {},
      weakVotes: {},
      votingOpen: false,
      voteOptions: [],
      votes: {},
      voteResolvedIndex: null
    });
    state.lastHistoryDocRef = await roomRef.collection("history").add({
      round: state.currentRound,
      kingName: state.myName,
      command: text,
      templateIndex: currentTemplateIndex,
      weakCount: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    const saveCheck = $("save-as-template-check");
    if (saveCheck && saveCheck.checked && currentTemplateIndex == null) {
      try {
        await roomRef.collection("customTemplates").add({
          text,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (err) {
        console.error("オリジナルテンプレートの保存に失敗しました", err);
      }
      saveCheck.checked = false;
    }
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  } finally {
    $("btn-send-command").disabled = false;
  }
});