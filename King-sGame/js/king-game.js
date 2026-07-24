/* ==========================================================
   king-game.js
   王様ゲーム本体ロジック(Firestoreでリアルタイム同期)
   ========================================================== */

/* ---------- Firebase 初期化 ---------- */
firebase.initializeApp(KING_GAME_FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();

/* ---------- 命令テンプレート(カテゴリ分け) ----------
   slots: 文中に埋め込む番号の数(1 or 2)
   text : {A} {B} を実際の番号に置き換えて使う
----------------------------------------- */
const COMMAND_CATEGORIES = [
  {
    label: "定番",
    items: [
      { slots: 1, text: "{A}番の人が今の気持ちを一言で表す" },
      { slots: 1, text: "{A}番の人が今日一番言いたかったことを言う" },
      { slots: 1, text: "次の乾杯の音頭を{A}番の人がとる" },
      { slots: 1, text: "{A}番の人が謎の高いテンションで挨拶する" },
      { slots: 1, text: "{A}番の人が店員さんにおすすめを聞く" },
      { slots: 1, text: "{A}番の人が今夜の一言目標を宣言する" },
      { slots: 1, text: "{A}番の人が好きな言葉を3秒以内に言う" },
      { slots: 1, text: "{A}番の人が今年やりたいことを1つ発表する" },
      { slots: 1, text: "{A}番の人が乾杯前に一言スピーチをする" },
      { slots: 1, text: "{A}番の人がグラスを掲げて誓いの言葉を言う" }
    ]
  },
  {
    label: "本音トーク",
    items: [
      { slots: 1, text: "{A}番の人が最近あった小さな幸せを話す" },
      { slots: 1, text: "{A}番の人が今ハマっていることを語る" },
      { slots: 2, text: "{A}番が{B}番に聞きたいことを一つ質問する" },
      { slots: 1, text: "{A}番の人が自分の長所を3つ言う" },
      { slots: 1, text: "{A}番の人が最近のちょっとした失敗談を話す" },
      { slots: 1, text: "{A}番の人が休日にしていることを話す" },
      { slots: 1, text: "{A}番の人が今の職場(学校)で一番好きなところを話す" },
      { slots: 2, text: "{A}番が{B}番の第一印象を教える" },
      { slots: 1, text: "{A}番の人が最近感動したことを話す" },
      { slots: 1, text: "{A}番の人が地味に得意なことを教える" },
      { slots: 1, text: "{A}番の人が今日一番楽しかった瞬間を話す" }
    ]
  },
  {
    label: "スキンシップ(軽め)",
    items: [
      { slots: 2, text: "{A}番と{B}番が腕を組む" },
      { slots: 2, text: "{A}番と{B}番が指切りげんまんする" },
      { slots: 2, text: "{A}番と{B}番でハイタッチする" },
      { slots: 2, text: "{A}番と{B}番でグータッチする" },
      { slots: 2, text: "{A}番と{B}番が背中合わせになる" },
      { slots: 2, text: "{A}番が{B}番の肩を揉んであげる" },
      { slots: 2, text: "{A}番と{B}番であっち向いてホイ勝負、負けた方が一杯飲む" },
      { slots: 2, text: "{A}番と{B}番が片手で握手をしたまま10秒キープ" },
      { slots: 2, text: "{A}番と{B}番でウィンクし合う" },
      { slots: 2, text: "{A}番と{B}番で指相撲をする" }
    ]
  },
  {
    label: "スキンシップ(ちょっと過激)",
    items: [
      { slots: 2, text: "{A}番と{B}番がハグをする" },
      { slots: 2, text: "{A}番と{B}番が10秒間見つめ合う" },
      { slots: 2, text: "{A}番と{B}番で耳打ちして一言伝え合う" },
      { slots: 2, text: "{A}番が{B}番にお酌をする" },
      { slots: 2, text: "{A}番と{B}番が腕相撲をする" },
      { slots: 2, text: "{A}番と{B}番が手をつないだまま乾杯する" },
      { slots: 2, text: "{A}番が{B}番の手のひらに指で文字を書いて当てっこする" }
    ]
  },
  {
    label: "頭脳戦・心理戦系",
    items: [
      { slots: 2, text: "{A}番と{B}番でしりとり対決、先に詰まった方が負け" },
      { slots: 2, text: "{A}番と{B}番で「せーの」で同じ数字(1〜5)を指で出せたら成功" },
      { slots: 2, text: "{A}番と{B}番で「せーの」で好きな色を同時に言い、一致するか試す" },
      { slots: 2, text: "{A}番と{B}番でどちらが先に瞬きするか我慢比べ" },
      { slots: 2, text: "{A}番と{B}番で、片方が出した手の形(グー/チョキ/パー)を見ずに当てる" }
    ]
  },
  {
    label: "ミニゲーム系",
    items: [
      { slots: 2, text: "{A}番と{B}番で片足立ち対決、先に足をついた方が負け" },
      { slots: 1, text: "{A}番の人が指定されたNGワードを使わずに1分間話す" },
      { slots: 2, text: "{A}番と{B}番でジャンケンを5回連続、多く勝った方が勝ち" },
      { slots: 2, text: "{A}番と{B}番で数字当てゲーム(1〜10の中で相手が思った数字を当てる)" },
      { slots: 1, text: "{A}番の人が目を閉じたまま10秒数えて、ぴったりで止められるか挑戦" }
    ]
  },
  {
    label: "親密度チャレンジ",
    items: [
      { slots: 1, text: "{A}番の人が自己紹介を一言で言い直す" },
      { slots: 2, text: "{A}番と{B}番が趣味を1つずつ紹介し合う" },
      { slots: 1, text: "{A}番の人が好きな食べ物ランキングを3位まで発表する" },
      { slots: 2, text: "{A}番と{B}番が今日の服装を褒め合う" },
      { slots: 1, text: "{A}番の人が最近ハマっているお店を紹介する" },
      { slots: 1, text: "{A}番の人が休日の過ごし方を話す" },
      { slots: 2, text: "{A}番と{B}番がお互いの出身地の話をする" },
      { slots: 1, text: "{A}番の人が好きな季節とその理由を話す" },
      { slots: 2, text: "{A}番と{B}番が好きな音楽のジャンルを紹介し合う" },
      { slots: 1, text: "{A}番の人が今日一番驚いたことを話す" },
      { slots: 2, text: "{A}番と{B}番が学生時代のちょっとした黒歴史を話す" },
      { slots: 2, text: "{A}番が{B}番のイメージを動物に例える" },
      { slots: 2, text: "{A}番と{B}番が肩を組んで一緒に写真を撮る" },
      { slots: 1, text: "{A}番の人が今のグループの中で誰に一番助けられているか話す" },
      { slots: 2, text: "{A}番と{B}番が「せーの」でお互いの第一印象を同時に言う" },
      { slots: 2, text: "{A}番と{B}番でハイタッチしながら一言褒め合う" },
      { slots: 2, text: "{A}番が{B}番のいいところを1つ教える" },
      { slots: 2, text: "{A}番と{B}番が腕を組んで乾杯する" },
      { slots: 1, text: "{A}番の人が今のメンバーとの思い出を1つ話す" },
      { slots: 2, text: "{A}番と{B}番が「せーの」で好きな相手のタイプを言い合う" },
      { slots: 1, text: "{A}番の人が今一番挑戦したいことを話す" },
      { slots: 2, text: "{A}番が{B}番に、最近気になっていることを1つ聞く" },
      { slots: 2, text: "{A}番と{B}番が「ここだけの話」を1つずつ交換する" },
      { slots: 1, text: "{A}番の人が自分が今頑張っていることを打ち明ける" },
      { slots: 2, text: "{A}番と{B}番が今夜お互いに感謝していることを伝え合う" },
      { slots: 1, text: "{A}番の人が最近悩んでいることを1つ話す" },
      { slots: 2, text: "{A}番と{B}番がお互いに直してほしいところを1つずつ、やわらかく伝え合う" },
      { slots: 1, text: "{A}番の人が今の自分に足りないと思うものを話す" },
      { slots: 2, text: "{A}番と{B}番が今夜の中で一番印象に残った瞬間を伝え合う" },
      { slots: 1, text: "{A}番の人が将来の夢や目標を1つ語る" }
    ]
  }
];

// カテゴリ構造をフラットな配列にも展開しておく(select の value と対応させるため)
const COMMAND_TEMPLATES_FLAT = [];
COMMAND_CATEGORIES.forEach((cat) => {
  cat.items.forEach((item) => {
    COMMAND_TEMPLATES_FLAT.push(item);
  });
});

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 紛らわしい文字(0/O/1/I)を除外
const MIN_SHUFFLE_MS = 1100; // くじ引きシャッフル演出の最低表示時間

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
  unsubRoom: null,
  unsubPlayers: null,
  unsubMe: null,
  unsubHistory: null
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
    const roomId = generateRoomCode();

    await db.collection("rooms").doc(roomId).set({
      hostUid: state.uid,
      status: "waiting",
      kingUid: null,
      lastKingUid: null,
      round: 1,
      playerCount: 0,
      currentCommand: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await db.collection("rooms").doc(roomId).collection("players").doc(state.uid).set({
      name,
      number: null,
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

    await roomRef.collection("players").doc(state.uid).set({
      name,
      number: null,
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

  listenToRoom();
  listenToPlayers();
  listenToHistory();
}

function listenToPlayers() {
  if (state.unsubPlayers) state.unsubPlayers();
  const playersRef = db.collection("rooms").doc(state.roomId).collection("players");

  state.unsubPlayers = playersRef.orderBy("joinedAt").onSnapshot(
    (snap) => {
      const players = [];
      snap.forEach((doc) => players.push({ id: doc.id, ...doc.data() }));
      state.playerCount = players.length;

      $("lobby-count").textContent = `(${players.length})`;
      $("lobby-player-list").innerHTML = players
        .map((p) => `<li>${escapeHtml(p.name)}</li>`)
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
      currentCommand: null
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

$("btn-close-room").addEventListener("click", closeRoom);
$("btn-close-room-2").addEventListener("click", closeRoom);

async function closeRoom() {
  if (!confirm("部屋を解散します。よろしいですか?")) return;
  try {
    const roomRef = db.collection("rooms").doc(state.roomId);
    const playersSnap = await roomRef.collection("players").get();
    const historySnap = await roomRef.collection("history").get();
    const batch = db.batch();
    playersSnap.forEach((doc) => batch.delete(doc.ref));
    historySnap.forEach((doc) => batch.delete(doc.ref));
    batch.delete(roomRef);
    await batch.commit();
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  }
  resetToHome();
}

function resetToHome() {
  cleanupListeners();
  sessionStorage.removeItem("kg_roomId");
  sessionStorage.removeItem("kg_isHost");
  sessionStorage.removeItem("kg_myName");
  state.roomId = null;
  state.isHost = false;
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

      if (room.status === "waiting") {
        if (!$("screen-lobby").classList.contains("is-active")) {
          enterLobby();
        }
      } else if (room.status === "drawn") {
        enterDrawScreen(room);
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
      snap.forEach((doc) => items.push(doc.data()));
      renderHistory(items);
    },
    (err) => console.error(err)
  );
}

function renderHistory(items) {
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

    if (amKing) setupKingPanel();
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

function setupKingPanel() {
  $("king-command-panel").hidden = false;

  const select = $("template-select");
  if (select.dataset.filled !== "1") {
    COMMAND_CATEGORIES.forEach((cat) => {
      const group = document.createElement("optgroup");
      group.label = cat.label;
      cat.items.forEach((item) => {
        const flatIndex = COMMAND_TEMPLATES_FLAT.indexOf(item);
        const opt = document.createElement("option");
        opt.value = flatIndex;
        opt.textContent = item.text.replace("{A}", "◯").replace("{B}", "△");
        group.appendChild(opt);
      });
      select.appendChild(group);
    });
    select.dataset.filled = "1";
  }

  select.onchange = () => applyTemplate();
  $("btn-reroll").onclick = () => rerollTargets();
  $("target-a-select").onchange = () => {
    populateTargetSelects(COMMAND_TEMPLATES_FLAT[currentTemplateIndex], { keepA: true });
    renderCommandFromTargets();
  };
  $("target-b-select").onchange = () => renderCommandFromTargets();
}

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

function applyTemplate() {
  const select = $("template-select");
  if (select.value === "") {
    $("btn-reroll").hidden = true;
    $("target-select-block").hidden = true;
    currentTemplateIndex = null;
    return;
  }
  currentTemplateIndex = Number(select.value);
  const tpl = COMMAND_TEMPLATES_FLAT[currentTemplateIndex];
  const nums = pickUniqueNumbers(tpl.slots, state.playerCount || 3, state.myNumber);

  populateTargetSelects(tpl);
  $("target-a-select").value = nums[0];
  if (tpl.slots === 2) {
    populateTargetSelects(tpl, { keepA: true });
    $("target-b-select").value = nums[1];
  }

  $("target-select-block").hidden = false;
  $("btn-reroll").hidden = false;
  renderCommandFromTargets();
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
  $("btn-send-command").disabled = true;

  try {
    const roomRef = db.collection("rooms").doc(state.roomId);
    await roomRef.update({
      status: "command",
      currentCommand: text
    });
    await roomRef.collection("history").add({
      round: state.currentRound,
      kingName: state.myName,
      command: text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error(err);
    showErrorBanner(friendlyErrorMessage(err));
  } finally {
    $("btn-send-command").disabled = false;
  }
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
}

$("btn-next-round").addEventListener("click", async () => {
  $("btn-next-round").disabled = true;
  try {
    const roomRef = db.collection("rooms").doc(state.roomId);
    const playersSnap = await roomRef.collection("players").get();
    const batch = db.batch();
    playersSnap.forEach((doc) => batch.update(doc.ref, { number: null }));
    batch.update(roomRef, {
      status: "waiting",
      kingUid: null,
      currentCommand: null,
      round: firebase.firestore.FieldValue.increment(1)
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
        if (doc.exists) {
          enterLobby();
        } else {
          resetToHome();
        }
      }).catch((err) => {
        console.error(err);
        showErrorBanner(friendlyErrorMessage(err));
      });
    });
  }
})();