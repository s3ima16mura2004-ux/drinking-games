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
  apiKey: "ここにAPIキーを入れる",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxxxxxxxx",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);