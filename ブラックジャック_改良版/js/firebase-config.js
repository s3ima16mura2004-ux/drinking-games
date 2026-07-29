// ==========================================================
// Firebase初期化
// ==========================================================
// 下記の firebaseConfig は、あなた自身のFirebaseプロジェクトの
// 「プロジェクトの設定 → 全般 → マイアプリ → SDKの設定と構成」に
// 表示される値に置き換えてください。
//
// 作り方の手順はこのフォルダの README.md に書いてあります。
// ==========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBjFHEtc6KxujygKJKpb4LeQPKuTRz7C9c",
  authDomain: "enkai-blackjack.firebaseapp.com",
  projectId: "enkai-blackjack",
  storageBucket: "enkai-blackjack.firebasestorage.app",
  messagingSenderId: "244344353587",
  appId: "1:244344353587:web:35eb6c9e4dee4800314446",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);