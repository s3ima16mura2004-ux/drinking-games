let playerCount = 3;
let players = [];
let currentTurnIndex = 0;
let totalChambers = 6;
let bulletPosition = Math.floor(Math.random() * totalChambers);
let currentAttempt = 0;
let isAnimating = false;

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

function startGame() {
    const inputs = document.querySelectorAll(".name-input");
    players = [];
    inputs.forEach(input => {
        players.push(input.value.trim() || input.placeholder);
    });

    currentTurnIndex = 0;
    currentAttempt = 0;
    bulletPosition = Math.floor(Math.random() * totalChambers);

    document.getElementById("setupScreen").style.display = "none";
    document.getElementById("gameScreen").style.display = "block";
    
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

    // クルッと回るアニメーションを付与
    status.classList.add("spinning");
    status.innerText = "🔄";

    setTimeout(() => {
        status.classList.remove("spinning");

        if (currentAttempt === bulletPosition) {
            // 当たり！
            status.innerText = "💥";
            let randomPenalty = penalties[Math.floor(Math.random() * penalties.length)];
            message.innerHTML = `<span style="color:#ff6b6b;">${players[currentTurnIndex]} が当たり！</span><br>罰ゲーム：${randomPenalty}`;
            btn.disabled = true;
            
            // ⬇️ 追加：もう一度遊ぶボタンを表示する
            document.getElementById("restartBtn").style.display = "block";
        } else {
            // セーフ
            status.innerText = "💨";
            message.innerText = `${players[currentTurnIndex]} はセーフ！生き残った！`;
            currentAttempt++;

            if (currentAttempt >= totalChambers) {
                message.innerText = "全員生き残った……奇跡のセーフ！";
                btn.disabled = true;
                
                // ⬇️ 追加：もう一度遊ぶボタンを表示する
                document.getElementById("restartBtn").style.display = "block";
            } else {
                // 次の人へ
                currentTurnIndex = (currentTurnIndex + 1) % players.length;
                setTimeout(() => {
                    updateTurnDisplay();
                    isAnimating = false;
                }, 1500);
                return;
            }
        }
        isAnimating = false;
    }, 600);
}

// 「もう一度遊ぶ」ボタンが押されたときの処理
function resetGame() {
    currentTurnIndex = 0;
    currentAttempt = 0;
    bulletPosition = Math.floor(Math.random() * totalChambers);
    
    // ボタンやステータスを初期状態に戻す
    document.getElementById("shootBtn").disabled = false;
    document.getElementById("restartBtn").style.display = "none";
    
    updateTurnDisplay();
}

// 最初に画面を開いたときの初期化実行
updateNameInputs();