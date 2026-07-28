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

// 【新機能】連続成功コンボ管理
let comboCount = {};

// 【新機能】音声読み上げON/OFF
let voiceEnabled = true;

const STORAGE_KEY_PENALTY = "partyGame_customPenalties";
const STORAGE_KEY_VOICE = "partyGame_voiceEnabled";

// 【簡易効果音（Web Audio API）】
function playSound(type) {
    try {
        let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

// 【新機能】音声読み上げ（Web Speech API）
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

// 【新機能】スマホ振動（Vibration API）
function vibrate(pattern) {
    if (navigator.vibrate) {
        try {
            navigator.vibrate(pattern);
        } catch (e) {
            // 非対応環境への配慮
        }
    }
}

// 【新機能】カスタム罰ゲーム・音声設定の保存＆読み込み
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
    } catch (e) {
        // localStorage非対応環境への配慮
    }
}

function saveSettings(customPenaltyText, voiceChecked) {
    try {
        localStorage.setItem(STORAGE_KEY_PENALTY, customPenaltyText);
        localStorage.setItem(STORAGE_KEY_VOICE, voiceChecked);
    } catch (e) {
        // localStorage非対応環境への配慮
    }
}

// 【新機能】連続成功コンボの加算とバナー表示
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

// 【新機能】シャッフルカード：まだめくられていないカードの中身を入れ替える
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

function updateNameInputs() {
    const container = document.getElementById("nameInputsContainer");
    container.innerHTML = "";
    for (let i = 0; i < playerCount; i++) {
        let input = document.createElement("input");
        input.type = "text";
        input.className = "name-input";
        input.placeholder = `プレイヤー${i + 1}`;
        input.value = `プレイヤー${i + 1}`;
        container.appendChild(input);
    }
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

    // 【新機能】音声＆カスタム罰ゲームの設定を反映
    let voiceToggle = document.getElementById("voiceToggle");
    voiceEnabled = voiceToggle.checked;

    let customPenaltyText = document.getElementById("customPenaltyInput").value;
    let customLines = customPenaltyText.split("\n").map(s => s.trim()).filter(s => s.length > 0);
    penalties = customLines.length > 0
        ? customLines.map(line => `❌ ハズレ！${line}`)
        : [...defaultPenalties];
    rewards = [...defaultRewards];

    saveSettings(customPenaltyText, voiceEnabled);

    currentTurnIndex = 0;
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

    document.getElementById("setupScreen").style.display = "none";
    document.getElementById("gameScreen").style.display = "block";
    document.getElementById("restartBtn").style.display = "none";
    
    updateStatusDisplay();
    startTimer();
}

// 【3. 制限時間タイマー開始】
function startTimer() {
    clearInterval(turnTimer);
    timeLeft = 10;
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
    resetCombo(currentName); // 【新機能】コンボリセット
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

    // 【新機能】めくる直前にドキドキ演出（一瞬揺れてから中身を見せる）
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

        // 【新機能】連続成功コンボを加算
        let combo = triggerCombo(currentName);

        if (val === '💣') {
            // 【1. 爆弾カード発動】
            playSound('bomb');
            vibrate([200, 100, 200]);
            eventMsg.style.color = "#ff4757";
            eventMsg.innerText = `💥 爆弾カード炸裂！！${currentName} は今すぐコンビニにダッシュしておつまみ（または飲み物）を買ってくるパシリの刑！`;
        } else if (val === '👀') {
            // 【2. 特殊カード（透視）発動】
            playSound('match');
            vibrate([60]);
            eventMsg.style.color = "#3498db";
            eventMsg.innerText = `👀 透視成功！もう一度あなたのターン＆ポイント2倍！`;
            scores[currentName]++; // ボーナス
        } else if (val === '👑') {
            // 【新機能】王様カード発動：誰か1人を指名して罰ゲームを実行させられる
            playSound('match');
            vibrate([100, 100, 100]);
            eventMsg.style.color = "#f9d423";
            eventMsg.innerText = `👑 王様カード成立！${currentName} は誰か1人を指名して、好きな罰ゲームを実行させることができる！`;
        } else if (val === '🔄') {
            // 【新機能】シャッフルカード発動：残りのカードの中身をシャッフル
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

        // 【新機能】3連続コンボボーナス（追加の一言）
        if (combo === 3) {
            eventMsg.innerText += `\n🌟 3連続ボーナス！${currentName} は周りの人からの質問攻めに答える刑！`;
        }

        speak(eventMsg.innerText);
        updateStatusDisplay();

        if (matchedCount === currentCards.length) {
            setTimeout(() => {
                let winner = Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b);
                eventMsg.style.color = "#f9d423";
                eventMsg.innerText = `🎉 ゲーム終了！勝者は ${winner} さん！ 🎉`;
                speak(eventMsg.innerText);
                document.getElementById("restartBtn").style.display = "block";
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
        resetCombo(currentName); // 【新機能】コンボリセット
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

updateNameInputs();
loadSavedSettings();