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

const rewards = [
    "✨ ペア成立！好きな人に一口飲ませる権！",
    "✨ ペア成立！右隣の人を5秒間で褒めちぎる！",
    "✨ ペア成立！自分のスコア＋1ポイント！もう一度めくれる！"
];

const penalties = [
    "❌ ハズレ！一気飲み！",
    "❌ ハズレ！次のターンまで語尾に「ぴょん」",
    "❌ ハズレ！自分のスマホの検索履歴を1つ発表",
    "❌ ハズレ！グラスの飲み物を一口飲む"
];

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
    inputs.forEach(input => {
        let name = input.value.trim() || input.placeholder;
        players.push(name);
        scores[name] = 0;
    });

    currentTurnIndex = 0;
    matchedCount = 0;
    
    // カードの準備（アイコン＋特殊カード・爆弾を混ぜる）
    let selectedIcons = cardValuesPool.slice(0, pairCount - 2); // 通常枠
    currentCards = [...selectedIcons, ...selectedIcons];
    
    // 【1. 爆弾カード追加】と【2. 特殊カード追加】
    currentCards.push('💣', '💣'); // 爆弾ペア
    currentCards.push('👀', '👀'); // 透視カードペア（揃えると自分だけカードを1枚先に見られる）

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
    let currentName = players[currentTurnIndex];
    let eventMsg = document.getElementById("eventMessage");
    eventMsg.style.color = "#ff6b6b";
    eventMsg.innerText = `⏰ タイムアウト！${currentName} の時間切れペナルティ（一気飲み）！`;

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
    if (this.classList.contains("flipped") || this.classList.contains("matched")) return;

    playSound('flip');
    this.innerText = this.dataset.value;
    this.classList.add("flipped");
    flippedCards.push(this);

    if (flippedCards.length === 2) {
        clearInterval(turnTimer); // 2枚めくったらタイマー一時停止
        checkMatch();
    }
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

        if (val === '💣') {
            // 【1. 爆弾カード発動】
            playSound('bomb');
            eventMsg.style.color = "#ff4757";
            eventMsg.innerText = `💥 爆弾カード炸裂！！${currentName} は今すぐコンビニにダッシュしておつまみ（または飲み物）を買ってくるパシリの刑！`;
        } else if (val === '👀') {
            // 【2. 特殊カード（透視）発動】
            playSound('match');
            eventMsg.style.color = "#3498db";
            eventMsg.innerText = `👀 透視成功！もう一度あなたのターン＆ポイント2倍！`;
            scores[currentName]++; // ボーナス
        } else {
            playSound('match');
            let randomReward = rewards[Math.floor(Math.random() * rewards.length)];
            eventMsg.style.color = "#2ecc71";
            eventMsg.innerText = `${currentName} がペア成功！\n${randomReward}`;
        }
        
        updateStatusDisplay();

        if (matchedCount === currentCards.length) {
            setTimeout(() => {
                let winner = Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b);
                eventMsg.style.color = "#f9d423";
                eventMsg.innerText = `🎉 ゲーム終了！勝者は ${winner} さん！ 🎉`;
                document.getElementById("restartBtn").style.display = "block";
            }, 500);
        } else {
            isLocked = false;
            startTimer(); // もう一度自分のターン
        }

    } else {
        // ハズレ
        playSound('wrong');
        isLocked = true;
        let randomPenalty = penalties[Math.floor(Math.random() * penalties.length)];
        eventMsg.style.color = "#ff6b6b";
        eventMsg.innerText = `${currentName} はハズレ…！\n${randomPenalty}`;

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
    document.getElementById("gameScreen").style.display = "none";
    document.getElementById("setupScreen").style.display = "block";
}

updateNameInputs();