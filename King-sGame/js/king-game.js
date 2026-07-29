/* ==========================================================
   king-game.js
   王様ゲーム本体ロジック(Firestoreでリアルタイム同期)
   ========================================================== */

/* ---------- Firebase 初期化 ---------- */
firebase.initializeApp(KING_GAME_FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();


const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 紛らわしい文字(0/O/1/I)を除外
const MIN_SHUFFLE_MS = 1100; // くじ引きシャッフル演出の最低表示時間
const ROOM_EXPIRY_MS = 2 * 60 * 60 * 1000; // 部屋の有効期限(作成から2時間)
const ROOM_EXPIRY_WARNING_MS = 15 * 60 * 1000; // 期限の15分前になったら警告を出す
const MAX_PLAYERS = 30; // 部屋あたりの参加人数の上限(ソフトキャップ)
let expiryWarningShown = false;
let expiryCheckTimer = null;

// 部屋の作成から2時間以上経過しているかどうかを判定する
function isRoomExpired(room) {
  if (!room || !room.createdAt || typeof room.createdAt.toMillis !== "function") return false;
  return Date.now() - room.createdAt.toMillis() > ROOM_EXPIRY_MS;
}

/* ---------- state ---------- */
const state = {
  uid: null,
  myName: "",
  roomId: null,
  isHost: false,
  playerCount: 0,
  myNumber: null,
  isKing: false,
  currentRound: 1,
  lastRoomStatus: null,
  enteredDrawRound: null,
  appliedResolvedVoteIndex: null,
  weakHintShownRound: null,
  lastAnnouncedKey: null,
  lastHistoryDocRef: null,
  lastWeakVotes: {},
  recentTemplateIndices: [],
  historyItems: [],
  customTemplates: [],
  unsubRoom: null,
  unsubPlayers: null,
  unsubMe: null,
  unsubHistory: null,
  unsubCustomTemplates: null
};

/* ---------- DOM ヘルパー ---------- */
const $ = (id) => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("is-active"));
  $(id).classList.add("is-active");
}

function setStatus(msg) {
  $("global-status").textContent = msg || "";
}

// ヘッダー下に「第◯幕」を表示する(ホーム画面では非表示)
function updateRoundIndicator() {
  const el = $("round-indicator");
  if (!el) return;
  el.hidden = false;
  el.textContent = `第${state.currentRound}幕`;
}

function hideRoundIndicator() {
  const el = $("round-indicator");
  if (el) el.hidden = true;
}

/* ---------- 設定: サウンド / バイブのON-OFF ---------- */
let soundEnabled = localStorage.getItem("kg_soundEnabled") !== "0";

function applySoundButtonLabel() {
  const btn = $("btn-toggle-sound");
  if (btn) btn.textContent = soundEnabled ? "🔔" : "🔕";
}

$("btn-toggle-sound").addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem("kg_soundEnabled", soundEnabled ? "1" : "0");
  applySoundButtonLabel();
});
applySoundButtonLabel();

// 命令発表の瞬間に鳴らす軽い効果音(外部音声ファイル不要、WebAudioでその場生成)+ バイブ
function playCommandRevealEffect() {
  if (!soundEnabled) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.25);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.5, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
      osc.onended = () => ctx.close();
    }
  } catch (err) {
    console.error(err);
  }
  if (navigator.vibrate) {
    try { navigator.vibrate([90, 40, 90]); } catch (err) { /* 対応していない端末は無視 */ }
  }
}

/* ---------- 設定: 季節テーマ切り替え ---------- */
const SEASON_BY_MONTH = {
  1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring",
  6: "summer", 7: "summer", 8: "summer", 9: "autumn", 10: "autumn",
  11: "autumn", 12: "winter"
};

function currentSeasonTheme() {
  return SEASON_BY_MONTH[new Date().getMonth() + 1] || "night";
}

function applyTheme(choice) {
  const resolved = choice === "auto" ? currentSeasonTheme() : choice;
  if (resolved === "night") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = resolved;
  }
}

(function initTheme() {
  const savedTheme = localStorage.getItem("kg_theme") || "auto";
  const select = $("theme-select");
  if (select) select.value = savedTheme;
  applyTheme(savedTheme);
})();

$("theme-select").addEventListener("change", () => {
  const value = $("theme-select").value;
  localStorage.setItem("kg_theme", value);
  applyTheme(value);
});

/* ---------- オンライン状況(プレゼンス表示) ---------- */
const PRESENCE_INTERVAL_MS = 12000;
const PRESENCE_ONLINE_THRESHOLD_MS = 25000;
let presenceTimer = null;

function pingPresence() {
  if (!state.roomId || !state.uid) return;
  db.collection("rooms").doc(state.roomId).collection("players").doc(state.uid)
    .update({ lastActiveMs: Date.now() })
    .catch(() => { /* 一時的な通信エラーは無視してよい */ });
}

function startPresenceHeartbeat() {
  stopPresenceHeartbeat();
  pingPresence();
  presenceTimer = setInterval(pingPresence, PRESENCE_INTERVAL_MS);
}

function stopPresenceHeartbeat() {
  if (presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") pingPresence();
});

/* ---------- 部屋の期限が近いことを知らせる ---------- */
function startExpiryWatch(room) {
  stopExpiryWatch();
  if (!room || !room.createdAt || typeof room.createdAt.toMillis !== "function") return;

  const createdMs = room.createdAt.toMillis();
  expiryWarningShown = false;

  const check = () => {
    const remaining = ROOM_EXPIRY_MS - (Date.now() - createdMs);
    if (remaining <= 0) {
      stopExpiryWatch();
      return;
    }
    if (remaining <= ROOM_EXPIRY_WARNING_MS && !expiryWarningShown) {
      expiryWarningShown = true;
      const minutes = Math.ceil(remaining / 60000);
      showErrorBanner(`この部屋はあと約${minutes}分で終了します。続ける場合は早めに進めてください。`, true);
    }
  };

  check();
  expiryCheckTimer = setInterval(check, 60 * 1000);
}

function stopExpiryWatch() {
  if (expiryCheckTimer) {
    clearInterval(expiryCheckTimer);
    expiryCheckTimer = null;
  }
}

/* ---------- エラーバナー ---------- */
let errorBannerTimer = null;

function showErrorBanner(msg, isInfo) {
  const banner = $("error-banner");
  $("error-banner-text").textContent = msg;
  banner.classList.toggle("is-info", !!isInfo);
  banner.hidden = false;

  if (errorBannerTimer) clearTimeout(errorBannerTimer);
  errorBannerTimer = setTimeout(() => { banner.hidden = true; }, 6000);
}

$("error-banner-close").addEventListener("click", () => {
  $("error-banner").hidden = true;
  if (errorBannerTimer) clearTimeout(errorBannerTimer);
});

window.addEventListener("offline", () => {
  showErrorBanner("オフラインになりました。通信環境を確認してください。");
});
window.addEventListener("online", () => {
  showErrorBanner("接続が回復しました。", true);
});

function friendlyErrorMessage(err) {
  if (!navigator.onLine) return "オフラインです。通信環境を確認してからもう一度お試しください。";
  if (err && err.code === "permission-denied") return "アクセスが拒否されました。Firestoreのルール設定を確認してください。";
  if (err && err.code === "unavailable") return "サーバーに接続できませんでした。しばらくしてからもう一度お試しください。";
  return "通信エラーが発生しました。もう一度お試しください。";
}

/* ---------- 認証 ---------- */
function ensureSignedIn() {
  return new Promise((resolve, reject) => {
    auth.onAuthStateChanged((user) => {
      if (user) {
        state.uid = user.uid;
        resolve(user.uid);
      }
    });
    auth.signInAnonymously().catch(reject);
  });
}

/* ---------- ユーティリティ ---------- */
function generateRoomCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

// 使われていない部屋コードを見つける(万が一の衝突に備えて数回リトライする)
async function generateUniqueRoomCode() {
  const MAX_ATTEMPTS = 5;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const code = generateRoomCode();
    const snap = await db.collection("rooms").doc(code).get();
    if (!snap.exists) return code;
  }
  throw new Error("部屋コードの採番に失敗しました");
}

// 期限切れの部屋を検知したら、居座らせずに掃除しておく(簡易クリーンアップ)
async function cleanupExpiredRoom(roomId) {
  try {
    const roomRef = db.collection("rooms").doc(roomId);
    const [playersSnap, historySnap, customTemplatesSnap] = await Promise.all([
      roomRef.collection("players").get(),
      roomRef.collection("history").get(),
      roomRef.collection("customTemplates").get()
    ]);
    const batch = db.batch();
    playersSnap.forEach((doc) => batch.delete(doc.ref));
    historySnap.forEach((doc) => batch.delete(doc.ref));
    customTemplatesSnap.forEach((doc) => batch.delete(doc.ref));
    batch.delete(roomRef);
    await batch.commit();
  } catch (err) {
    // 掃除に失敗しても致命的ではないので、握りつぶしてログだけ残す
    console.error("期限切れ部屋の掃除に失敗しました", err);
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickUniqueNumbers(count, max, exclude) {
  let candidates = Array.from({ length: max }, (_, i) => i + 1);
  if (exclude != null) {
    candidates = candidates.filter((n) => n !== exclude);
  }
  return shuffle(candidates).slice(0, count);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

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

  listenToRoom();
  listenToPlayers();
  listenToHistory();
  listenToCustomTemplates();
  startPresenceHeartbeat();
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

/* ==========================================================
   部屋全体の状態を監視して画面を切り替える
   ========================================================== */
function listenToRoom() {
  if (state.unsubRoom) state.unsubRoom();
  const roomRef = db.collection("rooms").doc(state.roomId);

  state.unsubRoom = roomRef.onSnapshot(
    (doc) => {
      if (!doc.exists) {
        setStatus("部屋が解散されました");
        resetToHome();
        return;
      }
      const room = doc.data();
      state.isKing = room.kingUid === state.uid;
      state.playerCount = room.playerCount || state.playerCount;
      state.currentRound = room.round || 1;
      updateRoundIndicator();
      startExpiryWatch(room);

      // ラウンドの切り替わりを検知して、全員に一瞬の通知を出す
      if (state.lastRoomStatus === "command" && room.status === "waiting") {
        showErrorBanner("次のラウンドが始まります", true);
      } else if (state.lastRoomStatus === "waiting" && room.status === "drawn") {
        showErrorBanner("くじ引きが始まりました!", true);
      }
      state.lastRoomStatus = room.status;

      if (room.status === "waiting") {
        if (!$("screen-lobby").classList.contains("is-active")) {
          enterLobby();
        }
      } else if (room.status === "drawn") {
        if (state.enteredDrawRound !== room.round) {
          state.enteredDrawRound = room.round;
          enterDrawScreen(room);
        }
        syncDrawExtras(room);
      } else if (room.status === "command") {
        enterCommandScreen(room);
      }
    },
    (err) => {
      console.error(err);
      showErrorBanner(friendlyErrorMessage(err));
    }
  );
}

/* ==========================================================
   ラウンド履歴
   ========================================================== */
function listenToHistory() {
  if (state.unsubHistory) state.unsubHistory();
  const historyRef = db.collection("rooms").doc(state.roomId).collection("history");

  state.unsubHistory = historyRef.orderBy("round").onSnapshot(
    (snap) => {
      const items = [];
      snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
      renderHistory(items);
      // 直近2件のテンプレート由来のお題は、ルーレットの抽選対象から一時的に外す
      state.recentTemplateIndices = items
        .slice(-2)
        .map((item) => item.templateIndex)
        .filter((v) => v != null);
    },
    (err) => console.error(err)
  );
}

function renderHistory(items) {
  state.historyItems = items;
  const html = items
    .map(
      (item) => `<li><span class="history-round-badge">第${item.round}幕</span>${escapeHtml(item.command)}
        <span class="history-king-name">王様: ${escapeHtml(item.kingName || "")}</span></li>`
    )
    .join("");

  $("lobby-history-list").innerHTML = html;
  $("command-history-list").innerHTML = html;
  $("lobby-history-panel").hidden = items.length === 0;
  $("command-history-panel").hidden = items.length === 0;
  renderDrawHistoryReuseList();
}

/* ---------- この部屋だけのオリジナルお題(自由入力から保存されたもの) ---------- */
function listenToCustomTemplates() {
  if (state.unsubCustomTemplates) state.unsubCustomTemplates();
  const ref = db.collection("rooms").doc(state.roomId).collection("customTemplates");

  state.unsubCustomTemplates = ref.orderBy("createdAt").onSnapshot(
    (snap) => {
      const items = [];
      snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
      state.customTemplates = items;
      const chip = $("custom-template-chip");
      if (chip) chip.hidden = items.length === 0;
    },
    (err) => console.error(err)
  );
}

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
  const count = Math.min(3, COMMAND_TEMPLATES_FLAT.length);
  const indices = shuffle(COMMAND_TEMPLATES_FLAT.map((_, i) => i)).slice(0, count);
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

  const chipsWrap = $("category-chips");
  if (chipsWrap.dataset.filled !== "1") {
    renderCategoryChips();
    chipsWrap.dataset.filled = "1";
  }

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
  wrap.innerHTML = COMMAND_CATEGORIES
    .map((cat, i) => `<button type="button" class="category-chip" data-cat="${i}" aria-pressed="false">${escapeHtml(cat.label)}</button>`)
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

function renderTemplateItemList(catIndex) {
  const cat = COMMAND_CATEGORIES[catIndex];
  const indices = cat.items.map((item) => COMMAND_TEMPLATES_FLAT.indexOf(item));
  $("template-item-list").innerHTML = buildTemplateItemsHtml(indices);
  wireTemplateItemButtons();
}

// キーワード検索(全カテゴリ横断)。マッチした項目にはカテゴリ名のタグを添える
function renderTemplateSearchResults(query) {
  const q = query.toLowerCase();
  const indices = COMMAND_TEMPLATES_FLAT
    .map((_, idx) => idx)
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
  const items = state.customTemplates || [];
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

$("btn-roulette-all").addEventListener("click", () => {
  const all = COMMAND_TEMPLATES_FLAT.map((_, i) => i);
  runRoulette(all, excludingRecentlyUsed(all));
});

$("btn-roulette-category").addEventListener("click", () => {
  if (selectedCategoryIndex == null) return;
  const pool = COMMAND_CATEGORIES[selectedCategoryIndex].items.map((item) => COMMAND_TEMPLATES_FLAT.indexOf(item));
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
    await roomRef.update({
      status: "command",
      currentCommand: text,
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

/* ---------- 音声読み上げ ---------- */
function speakCommand(text) {
  if (!text || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";
    utter.rate = 1.0;
    window.speechSynthesis.speak(utter);
  } catch (err) {
    console.error(err);
  }
}

$("btn-speak-command").addEventListener("click", () => {
  speakCommand($("command-display").textContent);
});

/* ==========================================================
   画面4: 命令発表
   ========================================================== */
function enterCommandScreen(room) {
  showScreen("screen-command");
  $("command-display").textContent = room.currentCommand || "";
  $("command-my-number").textContent = state.myNumber != null ? state.myNumber : "?";
  $("command-host-controls").hidden = !state.isHost;
  $("command-guest-note").hidden = state.isHost;

  const weakVotes = room.weakVotes || {};
  state.lastWeakVotes = weakVotes;
  const weakCount = Object.keys(weakVotes).length;
  $("weak-vote-count").textContent = weakCount > 0 ? `😅「弱いかも」: ${weakCount}人` : "";
  $("btn-weak-vote").hidden = state.isKing;
  $("btn-weak-vote").disabled = !!weakVotes[state.uid];

  // 同じ命令に対して効果音・読み上げを何度も再生しないように、ラウンド+命令文をキーにする
  const announceKey = `${room.round}|${room.currentCommand || ""}`;
  if (state.lastAnnouncedKey !== announceKey) {
    state.lastAnnouncedKey = announceKey;
    playCommandRevealEffect();
    if (soundEnabled) speakCommand(room.currentCommand || "");
  }
}

$("btn-weak-vote").addEventListener("click", async () => {
  if (!state.roomId || !state.uid) return;
  $("btn-weak-vote").disabled = true;
  try {
    await db.collection("rooms").doc(state.roomId).update({
      [`weakVotes.${state.uid}`]: true
    });
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
    $("btn-weak-vote").disabled = false;
  }
});

$("btn-next-round").addEventListener("click", async () => {
  $("btn-next-round").disabled = true;
  try {
    const roomRef = db.collection("rooms").doc(state.roomId);
    const playersSnap = await roomRef.collection("players").get();
    const weakCount = Object.keys(state.lastWeakVotes || {}).length;

    if (state.lastHistoryDocRef) {
      try {
        await state.lastHistoryDocRef.update({ weakCount });
      } catch (err) {
        console.error("履歴への弱票数の記録に失敗しました", err);
      }
    }

    const batch = db.batch();
    playersSnap.forEach((doc) => batch.update(doc.ref, { number: null }));
    batch.update(roomRef, {
      status: "waiting",
      kingUid: null,
      currentCommand: null,
      round: firebase.firestore.FieldValue.increment(1),
      weakVotes: {},
      lastWeakVoteCount: weakCount,
      votingOpen: false,
      voteOptions: [],
      votes: {},
      voteResolvedIndex: null
    });
    await batch.commit();
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  } finally {
    $("btn-next-round").disabled = false;
  }
});

/* ---------- 後片付け ---------- */
function cleanupListeners() {
  if (state.unsubRoom) state.unsubRoom();
  if (state.unsubPlayers) state.unsubPlayers();
  if (state.unsubMe) state.unsubMe();
  if (state.unsubHistory) state.unsubHistory();
  if (state.unsubCustomTemplates) state.unsubCustomTemplates();
  stopExpiryWatch();
  stopPresenceHeartbeat();
}

/* ==========================================================
   初期化: URLパラメータでの部屋コード引き継ぎ / 再接続
   ========================================================== */
(function init() {
  const params = new URLSearchParams(location.search);
  const roomFromUrl = params.get("room");
  if (roomFromUrl) {
    joinCodeBoxes.setValue(roomFromUrl);
  }

  const savedRoomId = sessionStorage.getItem("kg_roomId");
  if (savedRoomId) {
    ensureSignedIn().then(() => {
      state.roomId = savedRoomId;
      state.isHost = sessionStorage.getItem("kg_isHost") === "1";
      state.myName = sessionStorage.getItem("kg_myName") || "";
      db.collection("rooms").doc(savedRoomId).get().then((doc) => {
        if (doc.exists && !isRoomExpired(doc.data())) {
          enterLobby();
        } else {
          if (doc.exists) {
            showErrorBanner("この部屋は作成から2時間以上経過したため終了しました", true);
            cleanupExpiredRoom(savedRoomId);
          }
          resetToHome();
        }
      }).catch((err) => {
        console.error(err);
        showErrorBanner(friendlyErrorMessage(err));
      });
    });
  }
})();