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
  renderLobbyQrCode();

  if (localStorage.getItem("kg_seenLobbyOnboarding") !== "1") {
    $("lobby-onboarding").hidden = false;
  }

  listenToRoom();
  listenToPlayers();
  listenToHistory();
  listenToCustomTemplates();
  startPresenceHeartbeat();
}

$("btn-close-onboarding").addEventListener("click", () => {
  $("lobby-onboarding").hidden = true;
  localStorage.setItem("kg_seenLobbyOnboarding", "1");
});

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

$("btn-close-room").addEventListener("click", showRoomSummaryBeforeClose);
$("btn-close-room-2").addEventListener("click", showRoomSummaryBeforeClose);

async function showRoomSummaryBeforeClose() {
  try {
    const roomRef = db.collection("rooms").doc(state.roomId);
    const [roomSnap, playersSnap, historySnap] = await Promise.all([
      roomRef.get(),
      roomRef.collection("players").get(),
      roomRef.collection("history").get()
    ]);
    renderRoomSummary(roomSnap.data() || {}, playersSnap, historySnap);
    showScreen("screen-summary");
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  }
}

function renderRoomSummary(room, playersSnap, historySnap) {
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
  if (maxWeak > 0) {
    const topItem = historyItems.find((item) => (item.weakCount || 0) === maxWeak);
    weakHighlightEl.hidden = false;
    weakHighlightEl.textContent = `😅 一番「弱いかも」と言われた命令(第${topItem.round}幕・${maxWeak}票): ${topItem.command}`;
  } else {
    weakHighlightEl.hidden = true;
  }
}

$("btn-confirm-close-room").addEventListener("click", async () => {
  $("btn-confirm-close-room").disabled = true;
  try {
    const roomRef = db.collection("rooms").doc(state.roomId);
    const playersSnap = await roomRef.collection("players").get();
    const historySnap = await roomRef.collection("history").get();
    const customTemplatesSnap = await roomRef.collection("customTemplates").get();
    const batch = db.batch();
    playersSnap.forEach((doc) => batch.delete(doc.ref));
    historySnap.forEach((doc) => batch.delete(doc.ref));
    customTemplatesSnap.forEach((doc) => batch.delete(doc.ref));
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
  hideRoundIndicator();
  showScreen("screen-home");
}
