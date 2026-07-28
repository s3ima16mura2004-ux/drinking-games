let playerCount = 3;
let players = [];
let currentTurnIndex = 0;
let totalChambers = 6;
let bulletPosition = Math.floor(Math.random() * totalChambers);
let currentAttempt = 0;
let isAnimating = false;
let consecutiveSafe = 0;
let survivalCount = [];
let hitPlayerIndex = null;

const penalties = [
    // 飲み系
    "右隣の人と一気飲み！",
    "左右、隣の人と一気飲み！",
    "左隣の人と一気飲み！",
    "グラスの残りの半分を飲み干す",
    "両隣の人とアイコンタクトで「お疲れ様です」と言ってから飲む",
    "自分の好きなお酒をもう一杯おかわりして飲む",

    // 暴露・トーク系
    "自分のスマホの検索履歴を直近3件まで発表する",
    "今まで隠していた小さな秘密を1つカミングアウトする",
    "学生時代のちょっと恥ずかしいあだ名を発表する",
    "最近一番やらかした失敗談を1分で語る",

    // 無茶ぶり・キャラ付け系
    "右隣の人からリクエストされた「かっこいいセリフ」を全力で言う",
    "次の人が当たるまで、語尾に「にゃん」をつけて喋る",
    "左隣の人に照れずに真面目な愛の告白をする",
    "今この場で一番感謝している人を発表して、その場で褒めちぎる",
    "次の1分間、一切の笑い（表情・声）を禁止される"
];

// ユーザーが追加したオリジナル罰ゲーム
let customPenalties = [];

// 初期化：名前入力欄を作る
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

function changeCount(amount) {
    playerCount += amount;
    if (playerCount < 2) playerCount = 2;
    if (playerCount > 8) playerCount = 8;
    document.getElementById("playerCountText").innerText = playerCount;
    updateNameInputs();
}

// 弾数選択
function selectChamberCount(count) {
    totalChambers = count;
    document.querySelectorAll(".chamber-btn").forEach(btn => {
        btn.classList.toggle("active", parseInt(btn.dataset.count) === count);
    });
}

// オリジナル罰ゲーム追加
function addCustomPenalty() {
    const input = document.getElementById("customPenaltyInput");
    const text = input.value.trim();
    if (!text) return;
    customPenalties.push(text);
    input.value = "";
    renderCustomPenaltyList();
}

function removeCustomPenalty(index) {
    customPenalties.splice(index, 1);
    renderCustomPenaltyList();
}

function renderCustomPenaltyList() {
    const list = document.getElementById("customPenaltyList");
    list.innerHTML = "";
    customPenalties.forEach((text, i) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${text}</span><button onclick="removeCustomPenalty(${i})" aria-label="削除">×</button>`;
        list.appendChild(li);
    });
}

function startGame() {
    const inputs = document.querySelectorAll(".name-input");
    players = [];
    inputs.forEach(input => {
        players.push(input.value.trim() || input.placeholder);
    });

    currentTurnIndex = 0;
    currentAttempt = 0;
    consecutiveSafe = 0;
    hitPlayerIndex = null;
    survivalCount = new Array(players.length).fill(0);
    bulletPosition = Math.floor(Math.random() * totalChambers);

    document.getElementById("setupScreen").style.display = "none";
    document.getElementById("gameScreen").style.display = "block";
    document.getElementById("resultSummary").style.display = "none";
    document.getElementById("comboBanner").classList.remove("show");

    // 下部固定バーのボタンを「引き金を引く」に切り替え
    document.getElementById("startBtn").style.display = "none";
    document.getElementById("shootBtn").style.display = "block";
    document.getElementById("restartBtn").style.display = "none";

    updateTurnDisplay();
}

function updateTurnDisplay() {
    document.getElementById("turnIndicator").innerText = `👉 ${players[currentTurnIndex]} の番`;
    document.getElementById("message").innerText = "引き金を引いて運だめし…！";
    document.getElementById("status").innerText = "🥃";
}

function pullTrigger() {
    if (isAnimating) return;
    isAnimating = true;

    const status = document.getElementById("status");
    const message = document.getElementById("message");
    const btn = document.getElementById("shootBtn");

    btn.disabled = true;
    message.innerText = "";
    status.classList.remove("spinning");

    // カウントダウン演出：3→2→1→結果
    let count = 3;
    status.classList.add("count-pulse");
    status.innerText = count;

    const countdownTimer = setInterval(() => {
        count--;
        if (count > 0) {
            status.classList.remove("count-pulse");
            void status.offsetWidth; // リフローを強制してアニメーションを再生
            status.classList.add("count-pulse");
            status.innerText = count;
        } else {
            clearInterval(countdownTimer);
            status.classList.remove("count-pulse");
            revealResult();
        }
    }, 500);
}

function revealResult() {
    const status = document.getElementById("status");
    const message = document.getElementById("message");
    const btn = document.getElementById("shootBtn");

    status.classList.add("spinning");
    status.innerText = "🔄";

    setTimeout(() => {
        status.classList.remove("spinning");

        if (currentAttempt === bulletPosition) {
            // 当たり！
            status.innerText = "💥";
            if (navigator.vibrate) navigator.vibrate([120, 60, 220]);

            const allPenalties = penalties.concat(customPenalties);
            let randomPenalty = allPenalties[Math.floor(Math.random() * allPenalties.length)];
            message.innerHTML = `<span style="color:#ff6b6b;">${players[currentTurnIndex]} が当たり！</span><br>罰ゲーム：${randomPenalty}`;

            hitPlayerIndex = currentTurnIndex;
            consecutiveSafe = 0;
            endGame();
        } else {
            // セーフ
            status.innerText = "💨";
            message.innerText = `${players[currentTurnIndex]} はセーフ！生き残った！`;
            survivalCount[currentTurnIndex]++;
            consecutiveSafe++;
            showComboIfNeeded();
            currentAttempt++;

            if (currentAttempt >= totalChambers) {
                message.innerText = "全員生き残った……奇跡のセーフ！";
                endGame();
                return;
            } else {
                // 次の人へ
                currentTurnIndex = (currentTurnIndex + 1) % players.length;
                setTimeout(() => {
                    updateTurnDisplay();
                    btn.disabled = false;
                    isAnimating = false;
                }, 1500);
                return;
            }
        }
        isAnimating = false;
    }, 600);
}

// 連続セーフのコンボ演出
function showComboIfNeeded() {
    if (consecutiveSafe < 2) return; // 2連続以上から演出

    const banner = document.getElementById("comboBanner");
    const messages = {
        2: "🔥 2連続セーフ！空気が張り詰めてきた…",
        3: "😱 3連続セーフ！誰の心臓ももたない…！",
        4: "🌪️ 4連続セーフ！伝説の回になるか…！？"
    };
    const text = messages[consecutiveSafe] || `⚡ ${consecutiveSafe}連続セーフ！！奇跡が続いている…！`;

    banner.innerText = text;
    banner.classList.remove("show");
    void banner.offsetWidth;
    banner.classList.add("show");
}

// ゲーム終了時のMVP・記録表示
function endGame() {
    document.getElementById("shootBtn").style.display = "none";
    document.getElementById("restartBtn").style.display = "block";

    const summary = document.getElementById("resultSummary");

    // 生存数が最も多いプレイヤー（＝運が良かった人）を集計
    let maxSurvive = Math.max(...survivalCount);
    let mvpNames = players.filter((_, i) => survivalCount[i] === maxSurvive && maxSurvive > 0);

    let html = `<h3>🏆 今回の記録</h3>`;
    if (hitPlayerIndex !== null) {
        html += `<p>💥 散った者：<strong>${players[hitPlayerIndex]}</strong></p>`;
    }
    if (mvpNames.length > 0) {
        html += `<p>🍀 最も強運だったのは：<strong>${mvpNames.join("、")}</strong>（${maxSurvive}回セーフ）</p>`;
    }

    summary.innerHTML = html;
    summary.style.display = "block";
}

// 「もう一度遊ぶ」ボタンが押されたときの処理
function resetGame() {
    currentTurnIndex = 0;
    currentAttempt = 0;
    consecutiveSafe = 0;
    hitPlayerIndex = null;
    survivalCount = new Array(players.length).fill(0);
    bulletPosition = Math.floor(Math.random() * totalChambers);

    // ボタンやステータスを初期状態に戻す
    document.getElementById("shootBtn").disabled = false;
    document.getElementById("shootBtn").style.display = "block";
    document.getElementById("restartBtn").style.display = "none";
    document.getElementById("resultSummary").style.display = "none";
    document.getElementById("comboBanner").classList.remove("show");

    updateTurnDisplay();
}

// 最初に画面を開いたときの初期化実行
updateNameInputs();