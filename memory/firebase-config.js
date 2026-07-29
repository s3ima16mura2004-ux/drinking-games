// ============================================================
// 🔥 Firebaseプロジェクトの設定
// ------------------------------------------------------------
// Firebaseコンソール → プロジェクトの設定（歯車アイコン）→
// 「全般」タブ → 下の方の「マイアプリ」→ Webアプリの
// 「SDK の設定と構成」に表示される値をそのまま貼り付けてください。
//
// 王様ゲームなど、既存プロジェクトと同じFirebaseプロジェクトを
// 使い回して問題ありません。このゲームは Firestore の
// 「shinkei_rooms」という別コレクションにデータを保存するだけなので、
// 他のゲームのデータとぶつかることはありません。
//
// Firestoreの「ルール」タブで、開発中は下記のような緩いルールに
// しておくと動作確認しやすいです（身内向けの飲み会ゲームなので
// 本番でもこの程度で問題ありません。誰でも読み書きできる点だけ
// 認識しておいてください）:
//
//   rules_version = '2';
//   service cloud.firestore {
//     match /databases/{database}/documents {
//       match /shinkei_rooms/{roomCode} {
//         allow read, write: if true;
//       }
//     }
//   }
// ============================================================

const firebaseConfig = {
    apiKey: "AIzaSyCFHcgn-W7SZuEYFeKBHK4O_GYYoR9ztM8",
  authDomain: "king-s-game-69946.firebaseapp.com",
  projectId: "king-s-game-69946",
  storageBucket: "king-s-game-69946.firebasestorage.app",
  messagingSenderId: "77028177674",
  appId: "1:77028177674:web:7b2fb2f29323c25e0a2cf3"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
