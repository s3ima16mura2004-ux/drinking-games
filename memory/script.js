let playerCount = 2;
let pairCount = 4;
let players = [];
let scores = {};
let currentTurnIndex = 0;

let cardValuesPool = ['🍎', '🍌', '🍇', '⭐', '🍀', '🐱', '🔥', '💎'];
let currentCards = [];
let flippedCards = [];
let matchedCount = 0;
let isLocked = false;

// 制限時間タイマー関連
let turnTimer = null;
let timeLeft = 10;
let turnDuration = 10; // 【新機能】1ターンの制限時間（設定画面で変更可能）

const defaultRewards = [
    "✨ ペア成立！好きな人に一口飲ませる権！",
    "✨ ペア成立！右隣の人を5秒間で褒めちぎる！",
    "✨ ペア成立！自分のスコア＋1ポイント！もう一度めくれる！"
];

const defaultPenalties = [
    "❌ ハズレ！一気飲み！",
    "❌ ハズレ！次のターンまで語尾に「ぴょん」",
    "❌ ハズレ！自分のスマホの検索履歴を1つ発表",
    "❌ ハズレ！グラスの飲み物を一口飲む"
];

// 実際にゲーム中に使われる報酬・罰リスト（カスタム編集で上書きされる）
let rewards = [...defaultRewards];
let penalties = [...defaultPenalties];

// 連続成功コンボ管理
let comboCount = {};

// 音声読み上げ／効果音のON・OFF（別々に管理）
let voiceEnabled = true;
let soundEnabled = true;

// 初回読み込み時に保存済みの名前を復元するためのキャッシュ
let savedNamesCache = null;

// 使い回す単一のAudioContext（毎回生成すると環境によって音が途切れるため）
let sharedAudioCtx = null;

const STORAGE_KEY_PENALTY = "partyGame_customPenalties";
const STORAGE_KEY_VOICE = "partyGame_voiceEnabled";
const STORAGE_KEY_SOUND = "partyGame_soundEnabled";
const STORAGE_KEY_TIMER = "partyGame_turnDuration";
const STORAGE_KEY_NAMES = "partyGame_playerNames";

// 【簡易効果音（Web Audio API）】AudioContextは使い回して安定させる
function getAudioContext() {
    if (!sharedAudioCtx) {
        try {
            sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            return null;
        }
    }
    // ブラウザによってはタップ後にresumeが必要
    if (sharedAudioCtx.state === "suspended") {
        sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
}

function playSound(type) {
    if (!soundEnabled) return;
    try {
        let audioCtx = getAudioContext();
        if (!audioCtx) return;
        let osc = audioCtx.createOscillator();
        let gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (type === 'flip') {
            osc.frequency.setValueAtTime(400, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.08);
        } else if (type === 'match') {
            osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // レ
            osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1); // ラ
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.25);
        } else if (type === 'bomb' || type === 'wrong') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(120, audioCtx.currentTime);
            osc.frequency.setValueAtTime(60, audioCtx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.3);
        }
    } catch(e) {
        // AudioContextがブロックされている環境への配慮
    }
}

// 音声読み上げ（Web Speech API）
function speak(text) {
    if (!voiceEnabled) return;
    try {
        window.speechSynthesis.cancel();
        // 絵文字を除去して読み上げやすくする
        let cleanText = text.replace(/[✨❌💥👀👑🔄⏰🎉🔥🌟]/g, "").trim();
        let utter = new SpeechSynthesisUtterance(cleanText);
        utter.lang = "ja-JP";
        utter.rate = 1.05;
        utter.pitch = 1.0;
        window.speechSynthesis.speak(utter);
    } catch (e) {
        // Speech Synthesis非対応環境への配慮
    }
}

// スマホ振動（Vibration API）
function vibrate(pattern) {
    if (navigator.vibrate) {
        try {
            navigator.vibrate(pattern);
        } catch (e) {
            // 非対応環境への配慮
        }
    }
}

// 【新機能】設定・名前をlocalStorageに保存
function saveSettings(customPenaltyText, voiceChecked, soundChecked, timerSeconds, namesArray) {
    try {
        localStorage.setItem(STORAGE_KEY_PENALTY, customPenaltyText);
        localStorage.setItem(STORAGE_KEY_VOICE, voiceChecked);
        localStorage.setItem(STORAGE_KEY_SOUND, soundChecked);
        localStorage.setItem(STORAGE_KEY_TIMER, timerSeconds);
        localStorage.setItem(STORAGE_KEY_NAMES, JSON.stringify(namesArray));
    } catch (e) {
        // localStorage非対応環境への配慮
    }
}

// 保存済みの設定・名前を読み込んで画面に反映
function loadSavedSettings() {
    try {
        let savedPenalties = localStorage.getItem(STORAGE_KEY_PENALTY);
        if (savedPenalties) {
            document.getElementById("customPenaltyInput").value = savedPenalties;
        }

        let savedVoice = localStorage.getItem(STORAGE_KEY_VOICE);
        if (savedVoice !== null) {
            document.getElementById("voiceToggle").checked = savedVoice === "true";
        }

        let savedSound = localStorage.getItem(STORAGE_KEY_SOUND);
        if (savedSound !== null) {
            document.getElementById("soundToggle").checked = savedSound === "true";
        }

        let savedTimer = localStorage.getItem(STORAGE_KEY_TIMER);
        if (savedTimer) {
            let seconds = parseInt(savedTimer, 10);
            if (!isNaN(seconds)) {
                turnDuration = seconds;
                document.querySelectorAll(".timer-btn").forEach(btn => {
                    btn.classList.toggle("active", parseInt(btn.dataset.seconds, 10) === seconds);
                });
            }
        }

        let savedNames = localStorage.getItem(STORAGE_KEY_NAMES);
        if (savedNames) {
            let parsed = JSON.parse(savedNames);
            if (Array.isArray(parsed) && parsed.length > 0) {
                savedNamesCache = parsed;
                playerCount = Math.min(Math.max(parsed.length, 1), 6);
                document.getElementById("playerCountText").innerText = playerCount;
            }
        }
    } catch (e) {
        // localStorage非対応環境への配慮
    }
    updateNameInputs();
}

// 連続成功コンボの加算とバナー表示
function triggerCombo(name) {
    comboCount[name] = (comboCount[name] || 0) + 1;
    let combo = comboCount[name];
    if (combo >= 2) {
        showComboBanner(combo, name);
    }
    return combo;
}

function resetCombo(name) {
    comboCount[name] = 0;
}

function showComboBanner(combo, name) {
    let banner = document.createElement("div");
    banner.className = "combo-banner";
    if (combo >= 4) {
        banner.classList.add("combo-mega");
        banner.innerText = `🔥🔥🔥 ${combo}連続！${name} 絶好調！`;
    } else if (combo === 3) {
        banner.classList.add("combo-hot");
        banner.innerText = `🔥🔥 3連続コンボ！${name} 絶好調！`;
    } else {
        banner.innerText = `🔥 ${combo}連続コンボ！`;
    }
    document.getElementById("gameScreen").appendChild(banner);
    vibrate(combo >= 3 ? [100, 50, 100, 50, 100] : [80]);
    setTimeout(() => banner.remove(), 1500);
}

// シャッフルカード：まだめくられていないカードの中身を入れ替える
function shuffleRemainingCards() {
    let board = document.getElementById("board");
    let cards = Array.from(board.children).filter(c => !c.classList.contains("matched"));
    let values = cards.map(c => c.dataset.value);
    for (let i = values.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
    }
    cards.forEach((c, i) => {
        c.dataset.value = values[i];
    });
}

// 【バグ修正】参加人数を変更しても、すでに入力済みの名前は消さずに保持する
function updateNameInputs() {
    const container = document.getElementById("nameInputsContainer");
    const existingInputs = Array.from(container.querySelectorAll(".name-input"));
    let existingValues = existingInputs.map(input => input.value);

    // 初回読み込み時（入力欄が1つも無い状態）は保存済みの名前があればそれを使う
    if (existingValues.length === 0 && savedNamesCache) {
        existingValues = savedNamesCache;
    }

    container.innerHTML = "";
    for (let i = 0; i < playerCount; i++) {
        let input = document.createElement("input");
        input.type = "text";
        input.className = "name-input";
        input.placeholder = `プレイヤー${i + 1}`;
        // 既存の入力があれば復元し、新規に増えた枠だけデフォルト名にする
        input.value = (existingValues[i] && existingValues[i].trim() !== "")
            ? existingValues[i]
            : `プレイヤー${i + 1}`;
        container.appendChild(input);
    }
    savedNamesCache = null; // 一度反映したら使い切る
}

function changePlayerCount(amount) {
    playerCount += amount;
    if (playerCount < 1) playerCount = 1;
    if (playerCount > 6) playerCount = 6;
    document.getElementById("playerCountText").innerText = playerCount;
    updateNameInputs();
}

function setDifficulty(count, btnElement) {
    pairCount = count;
    document.querySelectorAll(".diff-btn").forEach(btn => btn.classList.remove("active"));
    btnElement.classList.add("active");
}

// 【新機能】1ターンの制限時間を選択
function setTimerDuration(seconds, btnElement) {
    turnDuration = seconds;
    document.querySelectorAll(".timer-btn").forEach(btn => btn.classList.remove("active"));
    btnElement.classList.add("active");
}

// デッキ（カード配列）を作成してボードに描画する共通処理
function buildDeckAndBoard() {
    matchedCount = 0;

    // カードの準備（アイコン＋特殊カードを混ぜる。難易度が上がるほど特殊カードも増える）
    let specialPairs = ['💣', '👀']; // 爆弾ペア／透視ペアは常に登場
    if (pairCount >= 6) specialPairs.push('👑'); // 王様カード（6ペア以上で登場）
    if (pairCount >= 8) specialPairs.push('🔄'); // シャッフルカード（8ペア以上で登場）

    let normalCount = pairCount - specialPairs.length;
    let selectedIcons = cardValuesPool.slice(0, normalCount); // 通常枠

    currentCards = [...selectedIcons, ...selectedIcons, ...specialPairs, ...specialPairs];
    currentCards.sort(() => Math.random() - 0.5);

    let board = document.getElementById("board");
    board.innerHTML = "";

    currentCards.forEach((val, index) => {
        let card = document.createElement("div");
        card.classList.add("card");
        card.dataset.value = val;
        card.dataset.index = index;
        card.innerText = "❓";
        card.addEventListener("click", flipCard);
        board.appendChild(card);
    });
}

function startGame() {
    const inputs = document.querySelectorAll(".name-input");
    players = [];
    scores = {};
    comboCount = {};
    inputs.forEach(input => {
        let name = input.value.trim() || input.placeholder;
        players.push(name);
        scores[name] = 0;
        comboCount[name] = 0;
    });

    // 音声・効果音・カスタム罰ゲームの設定を反映
    voiceEnabled = document.getElementById("voiceToggle").checked;
    soundEnabled = document.getElementById("soundToggle").checked;

    let customPenaltyText = document.getElementById("customPenaltyInput").value;
    let customLines = customPenaltyText.split("\n").map(s => s.trim()).filter(s => s.length > 0);
    penalties = customLines.length > 0
        ? customLines.map(line => `❌ ハズレ！${line}`)
        : [...defaultPenalties];
    rewards = [...defaultRewards];

    // 【新機能】次回のために設定と名前を保存
    saveSettings(customPenaltyText, voiceEnabled, soundEnabled, turnDuration, players);

    currentTurnIndex = 0;
    buildDeckAndBoard();

    document.getElementById("setupScreen").style.display = "none";
    document.getElementById("gameScreen").style.display = "block";
    document.getElementById("resultActions").style.display = "none";

    updateStatusDisplay();
    startTimer();
}

// 【新機能】結果画面から「同じメンバーでもう一度」
function quickPlayAgain() {
    scores = {};
    comboCount = {};
    players.forEach(p => {
        scores[p] = 0;
        comboCount[p] = 0;
    });
    currentTurnIndex = 0;

    buildDeckAndBoard();
    document.getElementById("resultActions").style.display = "none";

    updateStatusDisplay();
    startTimer();
}

// 制限時間タイマー開始（設定画面で選んだ秒数を使用）
function startTimer() {
    clearInterval(turnTimer);
    timeLeft = turnDuration;
    document.getElementById("timerBox").innerText = `残り: ${timeLeft}秒`;

    turnTimer = setInterval(() => {
        timeLeft--;
        document.getElementById("timerBox").innerText = `残り: ${timeLeft}秒`;
        if (timeLeft <= 0) {
            clearInterval(turnTimer);
            handleTimeOut();
        }
    }, 1000);
}

function handleTimeOut() {
    if (isLocked) return;
    isLocked = true;
    playSound('wrong');
    vibrate([300]);
    let currentName = players[currentTurnIndex];
    resetCombo(currentName);
    let eventMsg = document.getElementById("eventMessage");
    eventMsg.style.color = "#ff6b6b";
    eventMsg.innerText = `⏰ タイムアウト！${currentName} の時間切れペナルティ（一気飲み）！`;
    speak(eventMsg.innerText);

    setTimeout(() => {
        // めくっていたカードがあれば戻す
        flippedCards.forEach(c => {
            c.innerText = "❓";
            c.classList.remove("flipped");
        });
        flippedCards = [];
        
        currentTurnIndex = (currentTurnIndex + 1) % players.length;
        updateStatusDisplay();
        isLocked = false;
        eventMsg.style.color = "#aaa";
        eventMsg.innerText = "カードをめくってね";
        startTimer();
    }, 1800);
}

function updateStatusDisplay() {
    let currentName = players[currentTurnIndex];
    document.getElementById("turnIndicator").innerText = `👉 ${currentName} の番`;
    let scoreText = players.map(p => `${p}: ${scores[p]}pt`).join(" | ");
    document.getElementById("scoreBoard").innerText = scoreText;
}

function flipCard() {
    if (isLocked) return;
    if (this.classList.contains("flipped") || this.classList.contains("matched") || this.classList.contains("flipping")) return;

    const card = this;
    playSound('flip');
    vibrate([15]); // 【新機能】めくる瞬間の軽いタップ感

    // めくる直前にドキドキ演出（一瞬揺れてから中身を見せる）
    card.classList.add("flipping");

    setTimeout(() => {
        card.classList.remove("flipping");
        card.innerText = card.dataset.value;
        card.classList.add("flipped");
        flippedCards.push(card);

        if (flippedCards.length === 2) {
            clearInterval(turnTimer); // 2枚めくったらタイマー一時停止
            checkMatch();
        }
    }, 320);
}

function checkMatch() {
    let [card1, card2] = flippedCards;
    let currentName = players[currentTurnIndex];
    let eventMsg = document.getElementById("eventMessage");
    let val = card1.dataset.value;

    if (card1.dataset.value === card2.dataset.value) {
        card1.classList.add("matched");
        card2.classList.add("matched");
        flippedCards = [];
        matchedCount += 2;
        scores[currentName]++;

        // 連続成功コンボを加算
        let combo = triggerCombo(currentName);

        if (val === '💣') {
            // 爆弾カード発動
            playSound('bomb');
            vibrate([200, 100, 200]);
            eventMsg.style.color = "#ff4757";
            eventMsg.innerText = `💥 爆弾カード炸裂！！${currentName} は今すぐコンビニにダッシュしておつまみ（または飲み物）を買ってくるパシリの刑！`;
        } else if (val === '👀') {
            // 特殊カード（透視）発動
            playSound('match');
            vibrate([60]);
            eventMsg.style.color = "#3498db";
            eventMsg.innerText = `👀 透視成功！もう一度あなたのターン＆ポイント2倍！`;
            scores[currentName]++; // ボーナス
        } else if (val === '👑') {
            // 王様カード発動：誰か1人を指名して罰ゲームを実行させられる
            playSound('match');
            vibrate([100, 100, 100]);
            eventMsg.style.color = "#f9d423";
            eventMsg.innerText = `👑 王様カード成立！${currentName} は誰か1人を指名して、好きな罰ゲームを実行させることができる！`;
        } else if (val === '🔄') {
            // シャッフルカード発動：残りのカードの中身をシャッフル
            playSound('match');
            vibrate([50, 50, 50, 50, 50]);
            shuffleRemainingCards();
            eventMsg.style.color = "#a55eea";
            eventMsg.innerText = `🔄 シャッフルカード発動！残りのカードの中身がすべて入れ替わった！記憶をリセットせよ！`;
        } else {
            playSound('match');
            vibrate([50]);
            let randomReward = rewards[Math.floor(Math.random() * rewards.length)];
            eventMsg.style.color = "#2ecc71";
            eventMsg.innerText = `${currentName} がペア成功！\n${randomReward}`;
        }

        // 3連続コンボボーナス（追加の一言）
        if (combo === 3) {
            eventMsg.innerText += `\n🌟 3連続ボーナス！${currentName} は周りの人からの質問攻めに答える刑！`;
        }

        speak(eventMsg.innerText);
        updateStatusDisplay();

        if (matchedCount === currentCards.length) {
            setTimeout(() => {
                // 【新機能】同点の場合は全員の名前を表示する
                let maxScore = Math.max(...Object.values(scores));
                let winners = Object.keys(scores).filter(name => scores[name] === maxScore);

                eventMsg.style.color = "#f9d423";
                if (winners.length === 1) {
                    eventMsg.innerText = `🎉 ゲーム終了！勝者は ${winners[0]} さん！ 🎉`;
                } else {
                    eventMsg.innerText = `🎉 ゲーム終了！${winners.join("さんと")}さんが同点優勝！ 🎉`;
                }
                speak(eventMsg.innerText);
                document.getElementById("resultActions").style.display = "flex";
            }, 500);
        } else {
            isLocked = false;
            startTimer(); // もう一度自分のターン
        }

    } else {
        // ハズレ
        playSound('wrong');
        vibrate([150]);
        isLocked = true;
        resetCombo(currentName);
        let randomPenalty = penalties[Math.floor(Math.random() * penalties.length)];
        eventMsg.style.color = "#ff6b6b";
        eventMsg.innerText = `${currentName} はハズレ…！\n${randomPenalty}`;
        speak(eventMsg.innerText);

        setTimeout(() => {
            card1.innerText = "❓";
            card2.innerText = "❓";
            card1.classList.remove("flipped");
            card2.classList.remove("flipped");
            flippedCards = [];
            
            currentTurnIndex = (currentTurnIndex + 1) % players.length;
            updateStatusDisplay();
            
            isLocked = false;
            eventMsg.style.color = "#aaa";
            eventMsg.innerText = "カードをめくってね";
            startTimer();
        }, 2000);
    }
}

function returnToSetup() {
    clearInterval(turnTimer);
    window.speechSynthesis.cancel();
    document.getElementById("gameScreen").style.display = "none";
    document.getElementById("setupScreen").style.display = "block";
}

loadSavedSettings();