/* ==========================================================
   king-game-core.js
   共通基盤: Firebase初期化 / state / DOMヘルパー / サウンド・テーマ設定
   / プレゼンス・期限監視 / エラーバナー / 認証 / 汎用ユーティリティ
   ※ 他の king-game-*.js より先に読み込むこと
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
  players: [],
  lastToastAt: null,
  momentsItems: [],
  pendingMomentPhoto: null,
  summaryReportText: "",
  bannedKeywords: [],
  localRulesNote: "",
  excludedCategories: [],
  notifiedExemptionUids: [],
  unsubRoom: null,
  unsubPlayers: null,
  unsubMe: null,
  unsubHistory: null,
  unsubCustomTemplates: null,
  unsubMoments: null
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
    const [playersSnap, historySnap, customTemplatesSnap, momentsSnap] = await Promise.all([
      roomRef.collection("players").get(),
      roomRef.collection("history").get(),
      roomRef.collection("customTemplates").get(),
      roomRef.collection("moments").get()
    ]);
    const batch = db.batch();
    playersSnap.forEach((doc) => batch.delete(doc.ref));
    historySnap.forEach((doc) => batch.delete(doc.ref));
    customTemplatesSnap.forEach((doc) => batch.delete(doc.ref));
    momentsSnap.forEach((doc) => batch.delete(doc.ref));
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