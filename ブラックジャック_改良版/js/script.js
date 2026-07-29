/***********************************************
  1.グローバル変数
************************************************/

//カードの山(配列) 1〜52
let deck = [];
//捨て札(シャッフル効果で山に戻す用)
let discard = [];

//プレイヤー一覧
//status: 'waiting' | 'active' | 'stand' | 'bust' | 'skip'
let players = [];

//現在の手番のプレイヤー番号
let currentIndex = 0;

//ラウンド数
let round = 1;

//交換チケットで「誰と交換するか」選んでいる最中のプレイヤー番号
let swapUserIndex = null;

//ミニイベント/罰ゲームみくじのテキスト一覧(設定画面で編集可)
let eventList = [
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

let penaltyList = [
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

//ミニイベントが発生する確率(0〜1)
const EVENT_CHANCE = 0.25;
//ミニイベントの制限時間(秒)
const EVENT_SECONDS = 15;
//イベントタイマーのinterval ID
let eventTimerHandle = null;

//結果画面で今どのプレイヤーの罰ゲームみくじを引いているか
let penaltyTargetIndex = null;

//呪いの一枚(ナチュラル21ボーナス)で今誰が呪いをかけようとしているか
let curseCasterIndex = null;

//画面スリープ防止(共有端末を回し飲みしている間にスリープしないように)
let wakeLockRef = null;
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLockRef = await navigator.wakeLock.request("screen");
    }
  } catch (e) {
    //対応していない/取得できない場合は無視して続行する
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && wakeLockRef === null && el("screen-game")?.classList.contains("screen--active")) {
    requestWakeLock();
  }
});

/***********************************************
  2.要素の取得
************************************************/
const el = (id) => document.getElementById(id);

/***********************************************
  3.初期化・画面切り替え
************************************************/

window.addEventListener("load", () => {
  restoreCustomLists();
  renderNameInputs();

  el("btnMinus").addEventListener("click", () => changePlayerCount(-1));
  el("btnPlus").addEventListener("click", () => changePlayerCount(1));
  el("btnStart").addEventListener("click", startGame);

  el("btnHit").addEventListener("click", () => hit(currentIndex));
  el("btnStand").addEventListener("click", () => stand(currentIndex));
  el("btnJoker").addEventListener("click", useJoker);
  el("btnSwap").addEventListener("click", openSwapModal);
  el("btnSwapCancel").addEventListener("click", closeSwapModal);

  el("btnEventSuccess").addEventListener("click", () => resolveEvent(true));
  el("btnEventFail").addEventListener("click", () => resolveEvent(false));

  el("omikujiBox").addEventListener("click", drawPenaltyOmikuji);
  el("btnPenaltyClose").addEventListener("click", closePenaltyModal);

  el("btnReplayRound").addEventListener("click", () => resetGame(true));
  el("btnReplayAll").addEventListener("click", () => resetGame(false));

  el("btnCurseSkip").addEventListener("click", closeCurseModal);
});

//localStorageからカスタムイベント/罰ゲームリストを復元(あれば)
function restoreCustomLists() {
  try {
    const savedEvents = localStorage.getItem("bj_party_events");
    const savedPenalties = localStorage.getItem("bj_party_penalties");
    if (savedEvents) eventList = JSON.parse(savedEvents);
    if (savedPenalties) penaltyList = JSON.parse(savedPenalties);
  } catch (e) {
    //読み込みに失敗しても初期リストのまま続行する
  }
  el("eventListInput").value = eventList.join("\n");
  el("penaltyListInput").value = penaltyList.join("\n");
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("screen--active"));
  el(id).classList.add("screen--active");
}

/***********************************************
  4.設定画面
************************************************/

let playerCount = 4;

function changePlayerCount(delta) {
  playerCount = Math.min(8, Math.max(2, playerCount + delta));
  el("playerCountDisplay").textContent = playerCount;
  renderNameInputs();
}

function renderNameInputs() {
  el("playerCountDisplay").textContent = playerCount;
  const wrap = el("nameInputs");
  //既存の入力値は名前が変わらない範囲で保持する
  const prevValues = Array.from(wrap.querySelectorAll("input")).map((i) => i.value);
  wrap.innerHTML = "";
  for (let i = 0; i < playerCount; i++) {
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 8;
    input.placeholder = `プレイヤー${i + 1}`;
    input.value = prevValues[i] || "";
    input.dataset.playerIndex = i;
    wrap.appendChild(input);
  }
}

function startGame() {
  //名前入力欄から名前一覧を作る(空欄はプレースホルダーで補完)
  const inputs = Array.from(el("nameInputs").querySelectorAll("input"));
  const names = inputs.map((inp, i) => inp.value.trim() || `プレイヤー${i + 1}`);

  //ミニイベント/罰ゲームみくじのテキストを反映して保存
  const evText = el("eventListInput").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const peText = el("penaltyListInput").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (evText.length > 0) eventList = evText;
  if (peText.length > 0) penaltyList = peText;
  try {
    localStorage.setItem("bj_party_events", JSON.stringify(eventList));
    localStorage.setItem("bj_party_penalties", JSON.stringify(penaltyList));
  } catch (e) {
    //保存できなくてもゲームは続行する
  }

  players = names.map((name) => makePlayer(name));
  round = 1;
  beginRound();
  showScreen("screen-game");
}

function makePlayer(name) {
  return {
    name,
    cards: [],
    status: "waiting",
    joker: false,
    immunity: false,
    swapToken: false,
    natural: false,        // ナチュラル21(配られた2枚で21)だったか
    curseUsed: false,       // 呪いの一枚をすでに使ったか
    forcedPenalty: false,   // 呪いをかけられて罰ゲームみくじが確定しているか
    penaltyDrawn: false,    // 罰ゲームみくじをすでに引いたか
    penaltyText: null,
    rank: null,             // このラウンドの順位(1位が最も21に近い)
    isLast: false,          // このラウンドの最下位か
  };
}

/***********************************************
  5.ラウンド開始・カード管理
************************************************/

function beginRound() {
  //山札を作りシャッフルする
  deck = [];
  for (let i = 1; i <= 52; i++) deck.push(i);
  deck = shuffleArray(deck);
  discard = [];

  players.forEach((p) => {
    p.cards = [];
    p.status = "waiting";
    p.natural = false;
    p.curseUsed = false;
    p.forcedPenalty = false;
    p.penaltyDrawn = false;
    p.penaltyText = null;
    p.rank = null;
    p.isLast = false;
    //ジョーカー・免罪符・交換チケットはラウンドをまたいで持ち越す
  });

  //最初に2枚ずつ配る(効果は発動させない)
  players.forEach((p) => {
    p.cards.push(deck.pop(), deck.pop());
    p.natural = getTotal(p.cards) === 21;
  });

  currentIndex = 0;
  requestWakeLock();

  el("roundLabel").textContent = `ラウンド ${round}`;
  activatePlayer(0);
}

//手番プレイヤーをアクティブにする。ナチュラル21の場合は自動でスタンドする
function activatePlayer(index) {
  const p = players[index];
  if (!p) return;
  p.status = "active";
  render();
  if (p.natural) {
    showToast(`🌟 ${p.name} さん、ナチュラル21!`, true);
    setTimeout(() => stand(index), 900);
  }
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
  if (deck.length === 0) {
    //山札が尽きたら捨て札を戻してシャッフルする
    deck = shuffleArray(discard);
    discard = [];
  }
  return deck.pop();
}

//カードの合計を計算する(J,Q,Kは10、Aは1 or 11)
function getTotal(cardsArr) {
  let total = 0;
  let hasAce = false;
  for (const card of cardsArr) {
    const number = card % 13;
    if (number === 11 || number === 12 || number === 0) {
      total += 10;
    } else if (number === 1) {
      total += 1;
      hasAce = true;
    } else {
      total += number;
    }
  }
  if (hasAce && total + 10 <= 21) total += 10;
  return total;
}

function getCardPath(card) {
  return card <= 9 ? `../images/0${card}.png` : `../images/${card}.png`;
}

/***********************************************
  6.手番の進行(引く・勝負する)
************************************************/

function hit(index) {
  const p = players[index];
  if (p.status !== "active") return;
  //最大5枚までという元のルールを踏襲する
  if (p.cards.length >= 5) return;

  const card = drawCard();
  p.cards.push(card);
  applyCardEffect(index, card);

  if (getTotal(p.cards) > 21) {
    p.status = "bust";
    render();
    maybeTriggerMiniEvent(index, () => advanceTurn());
  } else {
    render();
  }
}

function stand(index) {
  const p = players[index];
  if (p.status !== "active") return;
  p.status = "stand";
  render();
  maybeTriggerMiniEvent(index, () => advanceTurn());
}

function advanceTurn() {
  currentIndex++;
  //「1回休み」が付いているプレイヤーは自動でスキップする
  while (currentIndex < players.length && players[currentIndex].status === "skip") {
    showToast(`⏭ ${players[currentIndex].name} さんは1回休みでした!`);
    players[currentIndex].status = "stand";
    currentIndex++;
  }
  if (currentIndex >= players.length) {
    showResults();
  } else {
    activatePlayer(currentIndex);
  }
}

/***********************************************
  7.特殊カード効果
************************************************/

function applyCardEffect(index, card) {
  const rank = card % 13;
  const p = players[index];

  if (rank === 1) {
    //A: ジョーカー(ミニイベント強制発動権)を獲得
    p.joker = true;
    showToast(`🎴 ${p.name} が「A」を引いた!ジョーカー🎭を獲得`);
  } else if (rank === 7) {
    //7: 罰ゲームみくじを1回だけ回避できるお守り
    p.immunity = true;
    showToast(`🍀 ${p.name} が「7」を引いた!御守り🛡を獲得`);
  } else if (rank === 11) {
    //J: 次の手番のプレイヤーを1回休みにする
    const nextIndex = index + 1;
    if (nextIndex < players.length) {
      players[nextIndex].status = "skip";
      showToast(`⏭ ${p.name} が「J」を引いた!次の${players[nextIndex].name}さんは1回休み!`);
    }
  } else if (rank === 12) {
    //Q: 山札をシャッフルし直す
    deck = shuffleArray(deck.concat(discard));
    discard = [];
    showToast(`🔀 ${p.name} が「Q」を引いた!山札をシャッフル!`);
  } else if (rank === 0) {
    //K: 交換チケットを獲得
    p.swapToken = true;
    showToast(`🔄 ${p.name} が「K」を引いた!交換チケットを獲得`);
  }
}

let toastHideHandle = null;
function showToast(message, isNatural) {
  const toast = el("effectToast");
  toast.textContent = message;
  toast.classList.toggle("is-natural", !!isNatural);
  toast.classList.add("is-visible");
  clearTimeout(toastHideHandle);
  toastHideHandle = setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

/***********************************************
  8.ジョーカー・交換チケットの使用
************************************************/

function useJoker() {
  const p = players[currentIndex];
  if (!p.joker) return;
  p.joker = false;
  render();
  showEventModal(p, () => render(), false);
}

function openSwapModal() {
  const p = players[currentIndex];
  if (!p.swapToken) return;
  swapUserIndex = currentIndex;
  const wrap = el("swapTargets");
  wrap.innerHTML = "";
  players.forEach((other, i) => {
    if (i === currentIndex) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = `${other.name} と交換する`;
    btn.addEventListener("click", () => performSwap(i));
    wrap.appendChild(btn);
  });
  el("modalSwap").classList.remove("hidden");
}

function closeSwapModal() {
  el("modalSwap").classList.add("hidden");
  swapUserIndex = null;
}

function performSwap(targetIndex) {
  const me = players[swapUserIndex];
  const target = players[targetIndex];
  if (me.cards.length === 0 || target.cards.length === 0) {
    closeSwapModal();
    return;
  }
  const myCardIdx = Math.floor(Math.random() * me.cards.length);
  const targetCardIdx = Math.floor(Math.random() * target.cards.length);
  const temp = me.cards[myCardIdx];
  me.cards[myCardIdx] = target.cards[targetCardIdx];
  target.cards[targetCardIdx] = temp;
  me.swapToken = false;
  showToast(`🔄 ${me.name} と ${target.name} がカードを交換した!`);
  closeSwapModal();
  render();
}

/***********************************************
  9.ミニイベント(ちょうちんタイム)
************************************************/

function maybeTriggerMiniEvent(index, callback) {
  if (Math.random() < EVENT_CHANCE) {
    showEventModal(players[index], callback, true);
  } else {
    callback();
  }
}

let eventCallback = null;

function showEventModal(player, callback, isAuto) {
  eventCallback = callback;
  const text = eventList[Math.floor(Math.random() * eventList.length)];
  el("eventPlayerName").textContent = `${player.name} さん、挑戦タイム!`;
  el("eventText").textContent = text;

  let remaining = EVENT_SECONDS;
  el("eventTimer").textContent = remaining;
  clearInterval(eventTimerHandle);
  eventTimerHandle = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      remaining = 0;
      clearInterval(eventTimerHandle);
    }
    el("eventTimer").textContent = remaining;
  }, 1000);

  el("modalEvent").classList.remove("hidden");
}

function resolveEvent(success) {
  clearInterval(eventTimerHandle);
  el("modalEvent").classList.add("hidden");
  const cb = eventCallback;
  eventCallback = null;

  if (success) {
    showToast("🎉 成功!盛り上がったところで続行!");
  } else {
    showToast("😅 残念…続行!");
  }
  if (cb) cb();
}

/***********************************************
  10.結果判定(21に一番近い人が1位、ディーラーなし)
************************************************/

//バーストは問答無用で最下位グループ、それ以外は21に近いほど上位
//同じ合計の人は同順位(例:1位、1位、3位)
function computeRankings() {
  const scored = players.map((p) => {
    const total = getTotal(p.cards);
    const busted = total > 21;
    return { total, busted, score: busted ? total - 1000 : total };
  });

  scored.forEach((s) => {
    s.rank = 1 + scored.filter((o) => o.score > s.score).length;
  });
  const maxRank = Math.max(...scored.map((s) => s.rank));
  const firstCount = scored.filter((s) => s.rank === 1).length;

  players.forEach((p, i) => {
    p.rank = scored[i].rank;
    p.isLast = scored[i].rank === maxRank;
  });

  return { firstCount };
}

function showResults() {
  const { firstCount } = computeRankings();
  renderResultList(firstCount);
  showScreen("screen-result");
}

function renderResultList(firstCount) {
  const list = el("resultList");
  list.innerHTML = "";

  //順位の良い順(1位から)に並べ替えて表示する
  const order = players
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.rank - b.p.rank);

  order.forEach(({ p, i }) => {
    const li = document.createElement("li");
    //色分けは既存のwin(緑)/lose(赤)/draw(金)スタイルを流用する
    const styleClass = p.rank === 1 ? "win" : p.isLast ? "lose" : "draw";
    li.className = `result-item ${styleClass}`;

    const label = `${p.rank}位${p.status === "bust" ? "(バースト)" : ""}`;
    const side = document.createElement("div");
    side.className = "side";
    side.innerHTML = `<strong>${p.name}</strong><span>合計 ${getTotal(p.cards)}</span>${p.natural ? ' <span class="badge" title="ナチュラル21">🌟</span>' : ""}`;
    li.appendChild(side);

    const right = document.createElement("div");
    right.className = "side";
    const outcomeSpan = document.createElement("span");
    outcomeSpan.className = "outcome";
    outcomeSpan.textContent = label;
    right.appendChild(outcomeSpan);

    //最下位、または「呪い」をかけられた場合に罰ゲームみくじの対象になる
    const needsPenalty = p.isLast || p.forcedPenalty;
    if (needsPenalty) {
      if (p.penaltyDrawn) {
        const doneSpan = document.createElement("span");
        doneSpan.textContent = p.penaltyText || "";
        right.appendChild(doneSpan);
      } else if (p.immunity) {
        p.immunity = false;
        p.penaltyDrawn = true;
        p.penaltyText = "🛡 御守りで回避!";
        const safe = document.createElement("span");
        safe.textContent = p.penaltyText;
        right.appendChild(safe);
      } else {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn--red";
        btn.textContent = p.isLast ? "罰ゲームみくじを引く" : "🌟 呪いの罰ゲームみくじを引く";
        btn.addEventListener("click", () => openPenaltyModal(i));
        right.appendChild(btn);
      }
    }

    //ナチュラル21のまま単独1位の人は、まだ呪いを使っていなければ誰かに罰ゲームを押し付けられる
    if (p.natural && p.rank === 1 && firstCount === 1 && !p.curseUsed && players.length > 1) {
      const curseBtn = document.createElement("button");
      curseBtn.type = "button";
      curseBtn.className = "btn btn--gold btn--small";
      curseBtn.textContent = "🌟 呪いをかける";
      curseBtn.addEventListener("click", () => openCurseModal(i));
      right.appendChild(curseBtn);
    }

    li.appendChild(right);
    list.appendChild(li);
  });

  updatePendingPenaltyHint();
}

//全員が罰ゲームみくじを引き終わるまで「次のラウンドへ」を押せないようにする
function updatePendingPenaltyHint() {
  let pending = 0;
  players.forEach((p) => {
    const needsPenalty = p.isLast || p.forcedPenalty;
    if (needsPenalty && !p.penaltyDrawn) pending++;
  });

  const hintEl = el("pendingPenaltyHint");
  const btn = el("btnReplayRound");
  if (pending > 0) {
    hintEl.textContent = `まだ${pending}人が罰ゲームみくじを引いていません`;
    hintEl.classList.remove("hidden");
    hintEl.classList.add("is-warning");
    btn.disabled = true;
  } else {
    hintEl.classList.add("hidden");
    btn.disabled = false;
  }
}


/***********************************************
  11.罰ゲームみくじ
************************************************/

function openPenaltyModal(index) {
  penaltyTargetIndex = index;
  el("penaltyTarget").textContent = `${players[index].name} さんの番です`;
  el("penaltyResult").classList.add("hidden");
  el("penaltyResult").textContent = "";
  el("btnPenaltyClose").classList.add("hidden");
  el("omikujiBox").classList.remove("hidden");
  el("modalPenalty").classList.remove("hidden");
}

function drawPenaltyOmikuji() {
  const box = el("omikujiBox");
  box.classList.add("is-shaking");
  box.style.pointerEvents = "none";
  setTimeout(() => {
    box.classList.remove("is-shaking");
    box.classList.add("hidden");
    const text = penaltyList[Math.floor(Math.random() * penaltyList.length)];
    const resultEl = el("penaltyResult");
    resultEl.textContent = text;
    resultEl.classList.remove("hidden");
    el("btnPenaltyClose").classList.remove("hidden");
    box.style.pointerEvents = "";

    if (penaltyTargetIndex !== null) {
      const p = players[penaltyTargetIndex];
      p.penaltyDrawn = true;
      p.penaltyText = text;
    }
  }, 600);
}

function closePenaltyModal() {
  el("modalPenalty").classList.add("hidden");
  penaltyTargetIndex = null;
  renderResultList();
}

/***********************************************
  11-2.呪いの一枚(ナチュラル21ボーナス)
************************************************/

function openCurseModal(casterIndex) {
  curseCasterIndex = casterIndex;
  const wrap = el("curseTargets");
  wrap.innerHTML = "";
  players.forEach((other, i) => {
    if (i === casterIndex) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = `${other.name} さんに呪いをかける`;
    btn.addEventListener("click", () => applyCurse(casterIndex, i));
    wrap.appendChild(btn);
  });
  el("modalCurse").classList.remove("hidden");
}

function closeCurseModal() {
  el("modalCurse").classList.add("hidden");
  curseCasterIndex = null;
}

function applyCurse(casterIndex, targetIndex) {
  players[casterIndex].curseUsed = true;
  players[targetIndex].forcedPenalty = true;
  showToast(`🌟 ${players[casterIndex].name} が ${players[targetIndex].name} さんに呪いをかけた!`);
  el("modalCurse").classList.add("hidden");
  curseCasterIndex = null;
  renderResultList();
}

/***********************************************
  12.画面描画
************************************************/

function render() {
  //現在の手番プレイヤー
  const p = players[currentIndex];
  if (p) {
    el("activePlayerName").textContent = `${p.name} さんの番`;
    el("turnLabel").textContent = `手番: ${p.name}`;
    renderCardRow("activeCards", p.cards);
    el("activeTotal").textContent = getTotal(p.cards);

    const badges = el("activeBadges");
    badges.innerHTML = "";
    if (p.joker) badges.innerHTML += `<span class="badge" title="ジョーカー">🎭</span>`;
    if (p.immunity) badges.innerHTML += `<span class="badge" title="御守り">🛡</span>`;
    if (p.swapToken) badges.innerHTML += `<span class="badge" title="交換チケット">🔄</span>`;

    const busted = p.status === "bust";
    const canAct = p.status === "active";
    el("btnHit").disabled = !canAct || busted || p.cards.length >= 5;
    el("btnStand").disabled = !canAct;
    el("btnJoker").classList.toggle("hidden", !(canAct && p.joker));
    el("btnSwap").classList.toggle("hidden", !(canAct && p.swapToken));
  }

  //控えのプレイヤー一覧
  const bench = el("benchList");
  bench.innerHTML = "";
  players.forEach((pl, i) => {
    if (i === currentIndex) return;
    const card = document.createElement("div");
    card.className = "bench-card";
    if (pl.status === "bust") card.classList.add("is-bust");
    const statusText =
      pl.status === "waiting" ? "順番待ち" :
      pl.status === "stand" ? "勝負済み" :
      pl.status === "bust" ? "バースト" :
      pl.status === "skip" ? "1回休み予定" : pl.status;
    card.innerHTML = `<div class="name">${pl.name}</div><div class="status">合計 ${getTotal(pl.cards)} ・ ${statusText}</div>`;
    bench.appendChild(card);
  });
}

function renderCardRow(elId, cardsArr) {
  const wrap = el(elId);
  wrap.innerHTML = "";
  cardsArr.forEach((c) => {
    const img = document.createElement("img");
    img.src = getCardPath(c);
    img.alt = "";
    wrap.appendChild(img);
  });
}

/***********************************************
  13.リセット
************************************************/

function resetGame(sameMembers) {
  if (sameMembers) {
    round++;
    beginRound();
    showScreen("screen-game");
  } else {
    location.reload();
  }
}