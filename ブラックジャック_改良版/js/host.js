/***********************************************
  宴会ブラックジャック - ホスト用ロジック
  ホストだけがゲーム状態を書き込む「唯一の書き込み役」。
  各プレイヤーは rooms/{code}/actions に操作リクエストを
  送るだけで、ホストがそれを順番に処理して状態を更新する。
************************************************/

import { db } from "./firebase-config.js";
import {
  doc, setDoc, updateDoc, deleteDoc, getDoc,
  collection, onSnapshot, query, orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const el = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/***********************************************
  1.定数・デフォルト設定
************************************************/
const EVENT_CHANCE = 0.25;
const EVENT_SECONDS = 15;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 紛らわしい 0/O, 1/I は除外

const DEFAULT_EVENTS = [
  "早口言葉「生麦生米生卵」を3回連続で言おう",
  "その場で一発ギャグを披露しよう",
  "右隣の人のモノマネをして一言喋ろう",
  "全員で息を合わせて「乾杯!」と言おう",
  "誰かとジャンケンをして3回連続で同じ手を出そう",
  "好きな芸能人を5人、10秒以内に言おう",
  "しりとりを時計回りに3周させよう",
  "目を閉じたまま自己紹介をしよう",
  "隣の人の良いところを3つ挙げよう",
  "今日あった良かったことを発表しよう",
];

const DEFAULT_PENALTIES = [
  "好きな飲み物を一口飲む(お酒でもソフトドリンクでもOK)",
  "その場で変な顔を5秒キープ",
  "次のラウンドの間、敬語で話す",
  "みんなに一言ずつありがとうを言う",
  "罰ゲームなし!今回はセーフ",
  "好きな歌のサビを歌う",
  "次のラウンド、利き手じゃない方でカードを引く",
  "誰か一人を褒めちぎる",
  "立ち上がって一回転する",
  "次の1ターン、口癖禁止(言ったら追加ペナルティ)",
];

/***********************************************
  2.状態(ホストがメモリ上で保持する「正」の状態)
************************************************/
let roomCode = null;
let roomRef = null;

let state = {
  status: "lobby", // lobby | playing | result
  round: 1,
  deck: [],
  discard: [],
  dealer: { cards: [] },
  order: [],
  currentIndex: 0,
  eventList: DEFAULT_EVENTS,
  penaltyList: DEFAULT_PENALTIES,
  activeEvent: null, // { playerId, text, startedAt, durationSec }
};

//プレイヤーIDをキーにした手札等の情報
let playersMap = {};

//ミニイベント解決後に呼ぶ継続処理(自動発生時のみ使用)
let pendingAfterEvent = null;

let lobbyPlayersUnsub = null;
let eventTickHandle = null;

/***********************************************
  3.初期化
************************************************/
window.addEventListener("load", () => {
  el("btnCreateRoom").addEventListener("click", createRoom);
  el("btnStartGame").addEventListener("click", startGame);
  el("btnNextRound").addEventListener("click", nextRound);
  el("btnEndRoom").addEventListener("click", endRoom);
});

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("screen--active"));
  el(id).classList.add("screen--active");
}

/***********************************************
  4.ルーム作成・ロビー
************************************************/

function generateRoomCode() {
  let code = "";
  for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

async function createRoom() {
  el("btnCreateRoom").disabled = true;
  //衝突を避けるため、既存のルームコードと被らないか確認する
  let code;
  for (let attempt = 0; attempt < 5; attempt++) {
    code = generateRoomCode();
    const existing = await getDoc(doc(db, "rooms", code));
    if (!existing.exists()) break;
  }
  roomCode = code;
  roomRef = doc(db, "rooms", roomCode);

  await setDoc(roomRef, {
    status: "lobby",
    round: 1,
    deck: [],
    discard: [],
    dealer: { cards: [] },
    order: [],
    currentIndex: 0,
    eventList: DEFAULT_EVENTS,
    penaltyList: DEFAULT_PENALTIES,
    activeEvent: null,
    createdAt: Date.now(),
  });

  el("roomCodeDisplay").textContent = roomCode;
  showScreen("screen-lobby");
  subscribeLobbyPlayers();
  subscribeActions();
}

function subscribeLobbyPlayers() {
  lobbyPlayersUnsub = onSnapshot(collection(roomRef, "players"), (snap) => {
    if (state.status !== "lobby") return;
    playersMap = {};
    snap.forEach((d) => {
      playersMap[d.id] = {
        name: d.data().name,
        joinedAt: d.data().joinedAt,
        cards: [], status: "waiting", joker: false, immunity: false,
        swapToken: false, outcome: null, penaltyText: null,
      };
    });
    renderLobby();
  });
}

function renderLobby() {
  const ids = Object.keys(playersMap);
  const list = el("lobbyPlayerList");
  list.innerHTML = "";
  ids.forEach((pid) => {
    const chip = document.createElement("span");
    chip.className = "player-chip";
    chip.textContent = playersMap[pid].name;
    list.appendChild(chip);
  });
  el("lobbyCountHint").textContent = ids.length === 0
    ? "まだ誰も参加していません"
    : `${ids.length}人が参加中`;
  el("btnStartGame").disabled = ids.length < 2;
}

/***********************************************
  5.アクションキューの購読・処理
************************************************/

let pendingActions = [];
let processingActions = false;

function subscribeActions() {
  const q = query(collection(roomRef, "actions"), orderBy("ts"));
  onSnapshot(q, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added") {
        pendingActions.push({ id: change.doc.id, data: change.doc.data() });
      }
    });
    drainActionQueue();
  });
}

async function drainActionQueue() {
  if (processingActions) return;
  processingActions = true;
  while (pendingActions.length > 0) {
    const action = pendingActions.shift();
    try {
      await handleAction(action.data);
    } catch (e) {
      console.error("アクション処理エラー", e);
    }
    try {
      await deleteDoc(doc(roomRef, "actions", action.id));
    } catch (e) {
      /* 削除に失敗しても続行 */
    }
  }
  processingActions = false;
}

async function handleAction(action) {
  const { type, playerId, payload } = action;
  if (type === "hit") await doHit(playerId);
  else if (type === "stand") await doStand(playerId);
  else if (type === "joker") await doJoker(playerId);
  else if (type === "swap") await doSwap(playerId, payload && payload.targetId);
  else if (type === "eventResult") await doEventResult(playerId, payload && payload.success);
  else if (type === "penaltyDraw") await doPenaltyDraw(playerId);
}

/***********************************************
  6.ラウンド開始・カード管理
************************************************/

async function startGame() {
  const ids = Object.keys(playersMap).sort((a, b) => (playersMap[a].joinedAt || 0) - (playersMap[b].joinedAt || 0));
  if (ids.length < 2) return;
  if (lobbyPlayersUnsub) { lobbyPlayersUnsub(); lobbyPlayersUnsub = null; }
  state.order = ids;
  state.round = 1;
  showScreen("screen-game");
  await beginRound();
}

async function beginRound() {
  state.deck = shuffleArray(freshDeck());
  state.discard = [];
  state.dealer = { cards: [] };
  state.activeEvent = null;

  state.order.forEach((pid) => {
    const p = playersMap[pid];
    p.cards = [];
    p.status = "waiting";
    p.outcome = null;
    p.penaltyText = null;
    //ジョーカー・御守り・交換チケットはラウンドをまたいで持ち越す
  });

  state.dealer.cards.push(drawCard(), drawCard());
  state.order.forEach((pid) => playersMap[pid].cards.push(drawCard(), drawCard()));

  state.currentIndex = 0;
  playersMap[state.order[0]].status = "active";
  state.status = "playing";

  await persistAll();
}

function freshDeck() {
  const d = [];
  for (let i = 1; i <= 52; i++) d.push(i);
  return d;
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawCard() {
  if (state.deck.length === 0) {
    state.deck = shuffleArray(state.discard);
    state.discard = [];
  }
  return state.deck.pop();
}

function getTotal(cardsArr) {
  let total = 0;
  let hasAce = false;
  for (const card of cardsArr) {
    const number = card % 13;
    if (number === 11 || number === 12 || number === 0) total += 10;
    else if (number === 1) { total += 1; hasAce = true; }
    else total += number;
  }
  if (hasAce && total + 10 <= 21) total += 10;
  return total;
}

function getCardPath(card) {
  return card <= 9 ? `../images/0${card}.png` : `../images/${card}.png`;
}

/***********************************************
  7.手番の進行
************************************************/

async function doHit(playerId) {
  const p = playersMap[playerId];
  if (!p || p.status !== "active" || p.cards.length >= 5) return;

  const card = drawCard();
  p.cards.push(card);
  applyCardEffect(playerId, card);

  if (getTotal(p.cards) > 21) {
    p.status = "bust";
    await persistAll();
    await maybeTriggerMiniEvent(playerId, advanceTurn);
  } else {
    await persistAll();
  }
}

async function doStand(playerId) {
  const p = playersMap[playerId];
  if (!p || p.status !== "active") return;
  p.status = "stand";
  await persistAll();
  await maybeTriggerMiniEvent(playerId, advanceTurn);
}

async function advanceTurn() {
  state.currentIndex++;
  while (state.currentIndex < state.order.length) {
    const pid = state.order[state.currentIndex];
    if (playersMap[pid].status === "skip") {
      playersMap[pid].status = "stand";
      showHostToast(`⏭ ${playersMap[pid].name} さんは1回休みでした!`);
      state.currentIndex++;
    } else break;
  }
  if (state.currentIndex >= state.order.length) {
    await persistAll();
    await dealerPlay();
  } else {
    playersMap[state.order[state.currentIndex]].status = "active";
    await persistAll();
  }
}

/***********************************************
  8.特殊カード効果
************************************************/

function applyCardEffect(playerId, card) {
  const rank = card % 13;
  const p = playersMap[playerId];

  if (rank === 1) {
    p.joker = true;
    showHostToast(`🎴 ${p.name} が「A」を引いた!ジョーカー🎭を獲得`);
  } else if (rank === 7) {
    p.immunity = true;
    showHostToast(`🍀 ${p.name} が「7」を引いた!御守り🛡を獲得`);
  } else if (rank === 11) {
    const myPos = state.order.indexOf(playerId);
    const nextPid = state.order[myPos + 1];
    if (nextPid) {
      playersMap[nextPid].status = "skip";
      showHostToast(`⏭ ${p.name} が「J」を引いた!次の${playersMap[nextPid].name}さんは1回休み!`);
    }
  } else if (rank === 12) {
    state.deck = shuffleArray(state.deck.concat(state.discard));
    state.discard = [];
    showHostToast(`🔀 ${p.name} が「Q」を引いた!山札をシャッフル!`);
  } else if (rank === 0) {
    p.swapToken = true;
    showHostToast(`🔄 ${p.name} が「K」を引いた!交換チケットを獲得`);
  }
}

/***********************************************
  9.ジョーカー・交換チケット(プレイヤーからのアクション)
************************************************/

async function doJoker(playerId) {
  const p = playersMap[playerId];
  if (!p || !p.joker) return;
  p.joker = false;
  state.activeEvent = {
    playerId, text: randomFrom(state.eventList), startedAt: Date.now(), durationSec: EVENT_SECONDS,
  };
  pendingAfterEvent = null; //手動発動はターン進行を止めない
  await persistAll();
}

async function doSwap(playerId, targetId) {
  const me = playersMap[playerId];
  const target = targetId && playersMap[targetId];
  if (!me || !target || !me.swapToken) return;
  if (me.cards.length === 0 || target.cards.length === 0) return;

  const mi = Math.floor(Math.random() * me.cards.length);
  const ti = Math.floor(Math.random() * target.cards.length);
  const temp = me.cards[mi];
  me.cards[mi] = target.cards[ti];
  target.cards[ti] = temp;
  me.swapToken = false;

  showHostToast(`🔄 ${me.name} と ${target.name} がカードを交換した!`);
  await persistAll();
}

/***********************************************
  10.ミニイベント(ちょうちんタイム)
************************************************/

function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function maybeTriggerMiniEvent(playerId, thenFn) {
  if (Math.random() < EVENT_CHANCE) {
    state.activeEvent = {
      playerId, text: randomFrom(state.eventList), startedAt: Date.now(), durationSec: EVENT_SECONDS,
    };
    pendingAfterEvent = thenFn;
    await persistAll();
  } else {
    await thenFn();
  }
}

async function doEventResult(playerId, success) {
  if (!state.activeEvent || state.activeEvent.playerId !== playerId) return;
  state.activeEvent = null;
  showHostToast(success ? "🎉 成功!盛り上がったところで続行!" : "😅 残念…続行!");
  const cont = pendingAfterEvent;
  pendingAfterEvent = null;
  await persistAll();
  if (cont) await cont();
}

/***********************************************
  11.ディーラーのプレイ・結果判定
************************************************/

async function dealerPlay() {
  await dealerStep();
}

async function dealerStep() {
  if (getTotal(state.dealer.cards) < 17) {
    state.dealer.cards.push(drawCard());
    await persistRoomOnly();
    renderHost();
    await sleep(700);
    await dealerStep();
  } else {
    await sleep(400);
    await computeResults();
  }
}

async function computeResults() {
  const dealerTotal = getTotal(state.dealer.cards);
  state.order.forEach((pid) => {
    const p = playersMap[pid];
    const myTotal = getTotal(p.cards);
    let outcome;
    if (myTotal > 21) outcome = "lose";
    else if (dealerTotal > 21) outcome = "win";
    else if (myTotal > dealerTotal) outcome = "win";
    else if (myTotal < dealerTotal) outcome = "lose";
    else outcome = "draw";
    p.outcome = outcome;
  });
  state.status = "result";
  await persistAll();
}

async function doPenaltyDraw(playerId) {
  const p = playersMap[playerId];
  if (!p || p.outcome !== "lose") return;
  if (p.immunity) {
    p.immunity = false;
    p.penaltyText = "🛡 御守りで回避!";
  } else {
    p.penaltyText = randomFrom(state.penaltyList);
  }
  await persistPlayer(playerId);
  renderHost();
}

async function nextRound() {
  state.round++;
  showScreen("screen-game");
  await beginRound();
}

async function endRoom() {
  for (const pid of state.order) {
    try { await deleteDoc(doc(roomRef, "players", pid)); } catch (e) { /* noop */ }
  }
  try { await deleteDoc(roomRef); } catch (e) { /* noop */ }
  location.reload();
}

/***********************************************
  12.永続化(Firestoreへの書き込み)
************************************************/

async function persistRoomOnly() {
  await setDoc(roomRef, {
    status: state.status,
    round: state.round,
    deck: state.deck,
    discard: state.discard,
    dealer: state.dealer,
    order: state.order,
    currentIndex: state.currentIndex,
    eventList: state.eventList,
    penaltyList: state.penaltyList,
    activeEvent: state.activeEvent,
  }, { merge: true });
}

async function persistPlayer(pid) {
  const p = playersMap[pid];
  await updateDoc(doc(roomRef, "players", pid), {
    cards: p.cards,
    status: p.status,
    joker: p.joker,
    immunity: p.immunity,
    swapToken: p.swapToken,
    outcome: p.outcome ?? null,
    penaltyText: p.penaltyText ?? null,
  });
}

async function persistAll() {
  await persistRoomOnly();
  await Promise.all(state.order.map(persistPlayer));
  renderHost();
}

/***********************************************
  13.トースト表示
************************************************/

let toastHideHandle = null;
function showHostToast(message) {
  const toast = el("effectToast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastHideHandle);
  toastHideHandle = setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

/***********************************************
  14.描画
************************************************/

function renderHost() {
  if (state.status === "lobby") return;

  if (state.status === "result") {
    renderResultScreen();
    return;
  }

  showScreen("screen-game");
  el("roundLabel").textContent = `ラウンド ${state.round}`;

  const activePid = state.order[state.currentIndex];
  el("turnLabel").textContent = activePid ? `手番: ${playersMap[activePid].name}` : "ディーラーの番です…";

  el("dealerTotal").textContent = getTotal(state.dealer.cards);
  renderCardRow("dealerCards", state.dealer.cards);

  renderEventBanner();

  const wrap = el("playersOverview");
  wrap.innerHTML = "";
  state.order.forEach((pid) => {
    const p = playersMap[pid];
    const box = document.createElement("div");
    box.className = "hand";
    if (pid === activePid) box.classList.add("hand--active");

    const badges = [];
    if (p.joker) badges.push("🎭");
    if (p.immunity) badges.push("🛡");
    if (p.swapToken) badges.push("🔄");

    const statusText = {
      waiting: "順番待ち", active: "手番中", stand: "勝負済み", bust: "バースト", skip: "1回休み予定",
    }[p.status] || p.status;

    box.innerHTML = `
      <h3>${p.name} ${badges.join(" ")} <span class="total-chip">${getTotal(p.cards)}</span> <span class="hint">${statusText}</span></h3>
      <div class="card-row" id="cards-${pid}"></div>
    `;
    wrap.appendChild(box);
    renderCardRow(`cards-${pid}`, p.cards);
  });
}

function renderCardRow(elId, cardsArr) {
  const wrap = el(elId);
  if (!wrap) return;
  wrap.innerHTML = "";
  cardsArr.forEach((c) => {
    const img = document.createElement("img");
    img.src = getCardPath(c);
    img.alt = "";
    wrap.appendChild(img);
  });
}

function renderEventBanner() {
  const banner = el("eventBanner");
  if (!state.activeEvent) {
    banner.classList.add("hidden");
    clearInterval(eventTickHandle);
    return;
  }
  banner.classList.remove("hidden");
  const targetName = playersMap[state.activeEvent.playerId]?.name || "";
  el("eventBannerTarget").textContent = `${targetName} さん、挑戦タイム!`;
  el("eventBannerText").textContent = state.activeEvent.text;

  clearInterval(eventTickHandle);
  const tick = () => {
    const elapsed = Math.floor((Date.now() - state.activeEvent.startedAt) / 1000);
    const remaining = Math.max(0, state.activeEvent.durationSec - elapsed);
    el("eventBannerTimer").textContent = remaining;
  };
  tick();
  eventTickHandle = setInterval(tick, 1000);
}

function renderResultScreen() {
  showScreen("screen-result");
  el("resultDealerTotal").textContent = getTotal(state.dealer.cards);

  const list = el("resultList");
  list.innerHTML = "";
  state.order.forEach((pid) => {
    const p = playersMap[pid];
    const li = document.createElement("li");
    li.className = `result-item ${p.outcome}`;
    const label = p.outcome === "win" ? "勝ち" : p.outcome === "lose" ? "負け" : "引き分け";
    const penaltyText = p.penaltyText ? ` — ${p.penaltyText}` : (p.outcome === "lose" ? " — みくじ待ち" : "");
    li.innerHTML = `
      <div class="side"><strong>${p.name}</strong><span>合計 ${getTotal(p.cards)}</span></div>
      <div class="side"><span class="outcome">${label}${penaltyText}</span></div>
    `;
    list.appendChild(li);
  });
}