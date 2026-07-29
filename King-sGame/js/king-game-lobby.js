/* ==========================================================
   king-game-lobby.js
   画面1(ホーム: 部屋を作る/参加する) + 画面2(待合室)
   部屋の解散前サマリー画面・ホームへのリセット処理もここに含む
   ========================================================== */

/* ---------- 部屋コード入力(6分割ボックス) ---------- */
function initCodeBoxes(container) {
  const boxes = Array.from(container.querySelectorAll(".code-box"));

  boxes.forEach((box, i) => {
    box.addEventListener("input", () => {
      box.value = box.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 1);
      if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
    });

    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !box.value && i > 0) {
        boxes[i - 1].focus();
      }
    });

    box.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = ((e.clipboardData || window.clipboardData).getData("text") || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      text.split("").forEach((ch, idx) => {
        if (boxes[idx]) boxes[idx].value = ch;
      });
      const next = boxes[Math.min(text.length, boxes.length - 1)];
      if (next) next.focus();
    });
  });

  return {
    getValue: () => boxes.map((b) => b.value).join(""),
    setValue: (str) => {
      const chars = (str || "").toUpperCase().split("");
      boxes.forEach((b, i) => { b.value = chars[i] || ""; });
    }
  };
}

const joinCodeBoxes = initCodeBoxes($("join-code-boxes"));

/* ==========================================================
   画面1: ホーム(部屋を作る / 参加する)
   ========================================================== */
$("btn-create-room").addEventListener("click", async () => {
  const name = $("host-name").value.trim();
  if (!name) return showHomeError("名前を入力してください");
  $("btn-create-room").disabled = true;

  try {
    await ensureSignedIn();
    const roomId = await generateUniqueRoomCode();

    await db.collection("rooms").doc(roomId).set({
      hostUid: state.uid,
      status: "waiting",
      kingUid: null,
      lastKingUid: null,
      round: 1,
      playerCount: 0,
      currentCommand: null,
      weakVotes: {},
      lastWeakVoteCount: 0,
      kingCounts: {},
      votingOpen: false,
      voteOptions: [],
      votes: {},
      voteResolvedIndex: null,
      localRulesNote: "",
      bannedKeywords: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await db.collection("rooms").doc(roomId).collection("players").doc(state.uid).set({
      name,
      number: null,
      lastActiveMs: Date.now(),
      joinedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    state.roomId = roomId;
    state.isHost = true;
    state.myName = name;
    sessionStorage.setItem("kg_roomId", roomId);
    sessionStorage.setItem("kg_isHost", "1");
    sessionStorage.setItem("kg_myName", name);

    enterLobby();
  } catch (err) {
    console.error(err);
    showHomeError("部屋の作成に失敗しました。通信環境を確認してください。");
    showErrorBanner(friendlyErrorMessage(err));
  } finally {
    $("btn-create-room").disabled = false;
  }
});

$("btn-join-room").addEventListener("click", async () => {
  const code = joinCodeBoxes.getValue();
  const name = $("join-name").value.trim();
  if (code.length < 6) return showHomeError("部屋コード6文字をすべて入力してください");
  if (!name) return showHomeError("名前を入力してください");
  $("btn-join-room").disabled = true;

  try {
    await ensureSignedIn();
    const roomRef = db.collection("rooms").doc(code);
    const roomSnap = await roomRef.get();

    if (!roomSnap.exists) {
      showHomeError("その部屋コードは見つかりませんでした");
      return;
    }
    if (roomSnap.data().status !== "waiting") {
      showHomeError("このゲームはすでに始まっています");
      return;
    }
    if (isRoomExpired(roomSnap.data())) {
      showHomeError("この部屋は作成から2時間以上経過しているため参加できません");
      cleanupExpiredRoom(code);
      return;
    }

    const existingPlayersSnap = await roomRef.collection("players").get();
    if (existingPlayersSnap.size >= MAX_PLAYERS
        && !existingPlayersSnap.docs.some((d) => d.id === state.uid)) {
      showHomeError(`この部屋は満員です(最大${MAX_PLAYERS}人)`);
      return;
    }

    await roomRef.collection("players").doc(state.uid).set({
      name,
      number: null,
      lastActiveMs: Date.now(),
      joinedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    state.roomId = code;
    state.isHost = roomSnap.data().hostUid === state.uid;
    state.myName = name;
    sessionStorage.setItem("kg_roomId", code);
    sessionStorage.setItem("kg_isHost", state.isHost ? "1" : "0");
    sessionStorage.setItem("kg_myName", name);

    enterLobby();
  } catch (err) {
    console.error(err);
    showHomeError("参加に失敗しました。部屋コードを確認してください。");
    showErrorBanner(friendlyErrorMessage(err));
  } finally {
    $("btn-join-room").disabled = false;
  }
});

function showHomeError(msg) {
  $("home-error").textContent = msg;
}

/* ==========================================================
   画面2: 待合室
   ========================================================== */
function enterLobby() {
  showScreen("screen-lobby");
  $("lobby-room-code").textContent = state.roomId;
  $("lobby-host-controls").hidden = !state.isHost;
  $("lobby-guest-note").hidden = state.isHost;
  $("local-rules-host-controls").hidden = !state.isHost;
  $("local-rules-guest-view").hidden = state.isHost;
  renderLobbyQrCode();

  if (localStorage.getItem("kg_seenLobbyOnboarding") !== "1") {
    $("lobby-onboarding").hidden = false;
  }

  listenToRoom();
  listenToPlayers();
  listenToHistory();
  listenToCustomTemplates();
  listenToMoments();
  startPresenceHeartbeat();
}

$("btn-close-onboarding").addEventListener("click", () => {
  $("lobby-onboarding").hidden = true;
  localStorage.setItem("kg_seenLobbyOnboarding", "1");
});

/* ---------- 📋 今夜のローカルルール・NGワード ---------- */
function renderLocalRules() {
  const noteInput = $("local-rules-note-input");
  const noteDisplay = $("local-rules-note-display");
  const keywords = state.bannedKeywords || [];

  // 入力中に上書きしてしまわないよう、フォーカス中は書き換えない
  if (document.activeElement !== noteInput) {
    noteInput.value = state.localRulesNote || "";
  }
  noteDisplay.textContent = state.localRulesNote
    ? state.localRulesNote
    : "今のところ特別なローカルルールはありません";

  const chipsWrap = $("ng-word-chips");
  chipsWrap.innerHTML = keywords.length
    ? keywords
        .map((w) => `<span class="ng-word-chip">${escapeHtml(w)}<button type="button" data-word="${escapeHtml(w)}" aria-label="削除">×</button></span>`)
        .join("")
    : '<span class="hint-text">まだNGワードはありません</span>';
  chipsWrap.querySelectorAll("button[data-word]").forEach((btn) => {
    btn.addEventListener("click", () => removeNgWord(btn.dataset.word));
  });

  const readonlyWrap = $("ng-word-chips-readonly");
  readonlyWrap.innerHTML = keywords.length
    ? keywords.map((w) => `<span class="ng-word-chip-readonly">🚫 ${escapeHtml(w)}</span>`).join("")
    : '<span class="hint-text">まだNGワードはありません</span>';
}

$("btn-save-local-rules-note").addEventListener("click", async () => {
  const note = $("local-rules-note-input").value.trim();
  try {
    await db.collection("rooms").doc(state.roomId).update({ localRulesNote: note });
    showErrorBanner("ローカルルールを保存しました", true);
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  }
});

$("btn-add-ng-word").addEventListener("click", async () => {
  const input = $("ng-word-input");
  const word = input.value.trim();
  if (!word) return;
  try {
    await db.collection("rooms").doc(state.roomId).update({
      bannedKeywords: firebase.firestore.FieldValue.arrayUnion(word)
    });
    input.value = "";
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  }
});

async function removeNgWord(word) {
  try {
    await db.collection("rooms").doc(state.roomId).update({
      bannedKeywords: firebase.firestore.FieldValue.arrayRemove(word)
    });
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  }
}

// 招待リンクのQRコードを描画(スマホのカメラで読み取って参加できるようにする)
function renderLobbyQrCode() {
  const wrap = $("lobby-qr-wrap");
  const target = $("lobby-qr-canvas");
  if (!wrap || !target) return;

  if (typeof qrcode === "undefined") {
    console.error("QRコード生成ライブラリが読み込めていません(js/qrcode-lib.jsを確認してください)");
    wrap.innerHTML = '<p class="hint-text qr-error">QRコードを読み込めませんでした。下の招待リンクをご利用ください。</p>';
    return;
  }

  try {
    const inviteUrl = `${location.origin}${location.pathname}?room=${state.roomId}`;
    // typeNumber 0 = 自動判定、errorCorrectionLevel 'M' = 標準的な誤り訂正レベル
    const qr = qrcode(0, "M");
    qr.addData(inviteUrl);
    qr.make();
    wrap.innerHTML = qr.createSvgTag(5, 0);
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="hint-text qr-error">QRコードの生成に失敗しました。下の招待リンクをご利用ください。</p>';
  }
}

function listenToPlayers() {
  if (state.unsubPlayers) state.unsubPlayers();
  const playersRef = db.collection("rooms").doc(state.roomId).collection("players");

  state.unsubPlayers = playersRef.orderBy("joinedAt").onSnapshot(
    (snap) => {
      const players = [];
      snap.forEach((doc) => players.push({ id: doc.id, ...doc.data() }));
      state.playerCount = players.length;
      state.players = players;

      $("lobby-count").textContent = `(${players.length}/${MAX_PLAYERS})`;
      $("lobby-player-list").innerHTML = players
        .map((p) => {
          const isOnline = typeof p.lastActiveMs === "number"
            && (Date.now() - p.lastActiveMs) < PRESENCE_ONLINE_THRESHOLD_MS;
          return `<li><span class="presence-dot${isOnline ? " is-online" : ""}"></span>${escapeHtml(p.name)}</li>`;
        })
        .join("");

      if (state.isHost) {
        $("btn-start-draw").disabled = players.length < 3;
      }
    },
    (err) => {
      console.error(err);
      showErrorBanner(friendlyErrorMessage(err));
    }
  );
}

$("btn-start-draw").addEventListener("click", async () => {
  $("btn-start-draw").disabled = true;
  try {
    const roomRef = db.collection("rooms").doc(state.roomId);
    const playersRef = roomRef.collection("players");
    const [roomSnap, playersSnap] = await Promise.all([roomRef.get(), playersRef.get()]);

    const playerIds = [];
    playersSnap.forEach((doc) => playerIds.push(doc.id));

    if (playerIds.length < 3) {
      $("btn-start-draw").disabled = false;
      return;
    }

    const shuffled = shuffle(playerIds);

    // 前回王様だった人を今回の候補から除外(連続指名を防ぐ)
    const lastKingUid = roomSnap.data().lastKingUid || null;
    let kingCandidates = shuffled.filter((uid) => uid !== lastKingUid);
    if (kingCandidates.length === 0) kingCandidates = shuffled;
    const kingUid = kingCandidates[Math.floor(Math.random() * kingCandidates.length)];

    const batch = db.batch();
    shuffled.forEach((uid, index) => {
      batch.update(playersRef.doc(uid), { number: index + 1 });
    });
    batch.update(roomRef, {
      status: "drawn",
      kingUid,
      lastKingUid: kingUid,
      playerCount: shuffled.length,
      currentCommand: null,
      [`kingCounts.${kingUid}`]: firebase.firestore.FieldValue.increment(1)
    });

    await batch.commit();
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
    $("btn-start-draw").disabled = false;
  }
});

$("btn-copy-link").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?room=${state.roomId}`;
  try {
    await navigator.clipboard.writeText(url);
    $("copy-feedback").textContent = "コピーしました!";
  } catch {
    $("copy-feedback").textContent = url;
  }
});

/* ---------- 🍻 乾杯・役割ルーレット(王様の命令とは別枠のミニ抽選) ---------- */
const TOAST_ROLE_PRESETS = ["乾杯の音頭取り", "次の買い出し係", "ドリンクを奢る人", "お会計係"];
let selectedToastRole = TOAST_ROLE_PRESETS[0];
let toastRouletteTimer = null;

function renderToastRoleChips() {
  const wrap = $("toast-role-chips");
  if (wrap.dataset.filled === "1") return;
  wrap.innerHTML = TOAST_ROLE_PRESETS
    .map((role, i) => `<button type="button" class="category-chip${i === 0 ? " is-active" : ""}" data-role="${escapeHtml(role)}" aria-pressed="${i === 0 ? "true" : "false"}">${escapeHtml(role)}</button>`)
    .join("");
  wrap.querySelectorAll(".category-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedToastRole = btn.dataset.role;
      $("toast-custom-role").value = "";
      wrap.querySelectorAll(".category-chip").forEach((b) => {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
    });
  });
  wrap.dataset.filled = "1";
}
renderToastRoleChips();

$("toast-custom-role").addEventListener("input", () => {
  const custom = $("toast-custom-role").value.trim();
  if (custom) {
    selectedToastRole = custom;
    $("toast-role-chips").querySelectorAll(".category-chip").forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-pressed", "false");
    });
  }
});

$("btn-spin-toast").addEventListener("click", () => {
  const pool = state.players || [];
  if (pool.length === 0) return;
  const role = ($("toast-custom-role").value.trim()) || selectedToastRole || TOAST_ROLE_PRESETS[0];

  if (toastRouletteTimer) clearTimeout(toastRouletteTimer);
  const display = $("toast-roulette-display");
  display.hidden = false;
  display.classList.remove("is-landing");
  $("btn-spin-toast").disabled = true;

  const TOTAL_STEPS = 16;
  const finalPlayer = pool[Math.floor(Math.random() * pool.length)];
  let step = 0;

  function tick() {
    step++;
    const isLast = step >= TOTAL_STEPS;
    const shown = isLast ? finalPlayer : pool[Math.floor(Math.random() * pool.length)];
    display.textContent = `🍻 ${shown.name}`;

    if (!isLast) {
      const delay = 40 + Math.round(Math.pow(step / TOTAL_STEPS, 2) * 240);
      toastRouletteTimer = setTimeout(tick, delay);
      return;
    }

    display.classList.add("is-landing");
    $("btn-spin-toast").disabled = false;
    playCommandRevealEffect();

    db.collection("rooms").doc(state.roomId).update({
      toastRoulette: {
        role,
        winnerName: finalPlayer.name,
        at: Date.now()
      }
    }).catch((err) => {
      console.error(err);
      showErrorBanner(friendlyErrorMessage(err));
    });
  }

  tick();
});

$("btn-close-room").addEventListener("click", showRoomSummaryBeforeClose);
$("btn-close-room-2").addEventListener("click", showRoomSummaryBeforeClose);

async function showRoomSummaryBeforeClose() {
  try {
    const roomRef = db.collection("rooms").doc(state.roomId);
    const [roomSnap, playersSnap, historySnap, momentsSnap] = await Promise.all([
      roomRef.get(),
      roomRef.collection("players").get(),
      roomRef.collection("history").get(),
      roomRef.collection("moments").get()
    ]);
    renderRoomSummary(roomSnap.data() || {}, playersSnap, historySnap, momentsSnap);
    showScreen("screen-summary");
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  }
}

let summaryGalleryItems = [];
let summaryGalleryIndex = 0;

function renderRoomSummary(room, playersSnap, historySnap, momentsSnap) {
  const nameByUid = {};
  playersSnap.forEach((doc) => { nameByUid[doc.id] = doc.data().name || "?"; });

  const historyItems = [];
  historySnap.forEach((doc) => historyItems.push(doc.data()));
  historyItems.sort((a, b) => (a.round || 0) - (b.round || 0));

  $("summary-round-count").textContent = historyItems.length;

  const kingCounts = room.kingCounts || {};
  const ranking = Object.entries(kingCounts)
    .map(([uid, count]) => ({ name: nameByUid[uid] || "(退出済み)", count }))
    .sort((a, b) => b.count - a.count);

  $("summary-king-ranking").innerHTML = ranking.length
    ? ranking
        .map(
          (r, i) => `<li><span class="summary-rank">${i + 1}位</span>${escapeHtml(r.name)}<span class="summary-rank-count">👑×${r.count}</span></li>`
        )
        .join("")
    : '<li class="hint-text">記録がありません</li>';

  const maxWeak = historyItems.reduce((max, item) => Math.max(max, item.weakCount || 0), 0);
  const weakHighlightEl = $("summary-weak-highlight");
  let weakHighlightText = "";
  if (maxWeak > 0) {
    const topItem = historyItems.find((item) => (item.weakCount || 0) === maxWeak);
    weakHighlightText = `😅 一番「弱いかも」と言われた命令(第${topItem.round}幕・${maxWeak}票): ${topItem.command}`;
    weakHighlightEl.hidden = false;
    weakHighlightEl.textContent = weakHighlightText;
  } else {
    weakHighlightEl.hidden = true;
  }

  // 📸 今日のベストショット(拍手が多い順 → ラウンド順)
  const moments = [];
  momentsSnap.forEach((doc) => moments.push(doc.data()));
  moments.sort((a, b) => {
    const clapDiff = Object.keys(b.claps || {}).length - Object.keys(a.claps || {}).length;
    if (clapDiff !== 0) return clapDiff;
    return (a.round || 0) - (b.round || 0);
  });
  summaryGalleryItems = moments;
  summaryGalleryIndex = 0;
  $("summary-gallery").hidden = moments.length === 0;
  if (moments.length) renderSummaryGalleryFrame();

  // 📋 コピー用の簡易レポートを組み立てておく
  const reportLines = [
    "🏮 王様ゲーム 今宵の記録",
    `ラウンド数: ${historyItems.length}`,
    "",
    "👑 王様ランキング",
    ...(ranking.length ? ranking.map((r, i) => `${i + 1}位 ${r.name}(${r.count}回)`) : ["記録なし"])
  ];
  if (weakHighlightText) reportLines.push("", weakHighlightText);
  if (moments.length) {
    reportLines.push("", "📸 印象に残った瞬間");
    moments.slice(0, 5).forEach((m) => {
      const claps = Object.keys(m.claps || {}).length;
      reportLines.push(`・第${m.round}幕 ${m.comment || "(コメントなし)"}(👏${claps})`);
    });
  }
  state.summaryReportText = reportLines.join("\n");
}

function renderSummaryGalleryFrame() {
  const item = summaryGalleryItems[summaryGalleryIndex];
  if (!item) return;
  const img = $("summary-gallery-img");
  if (item.photoDataUrl) {
    img.src = item.photoDataUrl;
    img.hidden = false;
  } else {
    img.hidden = true;
  }
  $("summary-gallery-comment").textContent = item.comment || "(コメントなし)";
  const clapCount = Object.keys(item.claps || {}).length;
  $("summary-gallery-meta").textContent = `第${item.round}幕・${item.authorName || ""}・👏${clapCount}`;
  $("summary-gallery-position").textContent = `${summaryGalleryIndex + 1} / ${summaryGalleryItems.length}`;
}

$("btn-gallery-prev").addEventListener("click", () => {
  if (!summaryGalleryItems.length) return;
  summaryGalleryIndex = (summaryGalleryIndex - 1 + summaryGalleryItems.length) % summaryGalleryItems.length;
  renderSummaryGalleryFrame();
});

$("btn-gallery-next").addEventListener("click", () => {
  if (!summaryGalleryItems.length) return;
  summaryGalleryIndex = (summaryGalleryIndex + 1) % summaryGalleryItems.length;
  renderSummaryGalleryFrame();
});

$("btn-copy-report").addEventListener("click", async () => {
  const text = state.summaryReportText || "";
  try {
    await navigator.clipboard.writeText(text);
    showErrorBanner("レポートをコピーしました", true);
  } catch (err) {
    console.error(err);
    showErrorBanner("コピーに失敗しました。手動で選択してコピーしてください。");
  }
});


$("btn-confirm-close-room").addEventListener("click", async () => {
  $("btn-confirm-close-room").disabled = true;
  try {
    const roomRef = db.collection("rooms").doc(state.roomId);
    const playersSnap = await roomRef.collection("players").get();
    const historySnap = await roomRef.collection("history").get();
    const customTemplatesSnap = await roomRef.collection("customTemplates").get();
    const momentsSnap = await roomRef.collection("moments").get();
    const batch = db.batch();
    playersSnap.forEach((doc) => batch.delete(doc.ref));
    historySnap.forEach((doc) => batch.delete(doc.ref));
    customTemplatesSnap.forEach((doc) => batch.delete(doc.ref));
    momentsSnap.forEach((doc) => batch.delete(doc.ref));
    batch.delete(roomRef);
    await batch.commit();
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  } finally {
    $("btn-confirm-close-room").disabled = false;
  }
  resetToHome();
});

$("btn-cancel-close-room").addEventListener("click", () => {
  // 直前にいた状況に応じて自然な画面に戻す(リスナーは解散手続き中も維持したまま)
  showScreen(state.lastRoomStatus === "command" ? "screen-command" : "screen-lobby");
});

function resetToHome() {
  cleanupListeners();
  sessionStorage.removeItem("kg_roomId");
  sessionStorage.removeItem("kg_isHost");
  sessionStorage.removeItem("kg_myName");
  state.roomId = null;
  state.isHost = false;
  state.enteredDrawRound = null;
  state.appliedResolvedVoteIndex = null;
  state.weakHintShownRound = null;
  state.lastAnnouncedKey = null;
  state.lastHistoryDocRef = null;
  state.lastWeakVotes = {};
  state.recentTemplateIndices = [];
  state.historyItems = [];
  state.customTemplates = [];
  state.players = [];
  state.lastToastAt = null;
  state.momentsItems = [];
  state.pendingMomentPhoto = null;
  state.bannedKeywords = [];
  state.localRulesNote = "";
  hideRoundIndicator();
  showScreen("screen-home");
}