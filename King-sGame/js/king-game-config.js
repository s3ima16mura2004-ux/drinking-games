/* ==========================================================
   king-game-config.js
   王様ゲーム専用の新しいFirebaseプロジェクトの設定ファイル

   【セットアップ手順】
   1. https://console.firebase.google.com/ で新しいプロジェクトを作成
      (例: プロジェクト名「king-game-app」)
   2. 「Firestore Database」を有効化 → 本番環境モードで開始
   3. 「Authentication」→「Sign-in method」→「匿名」を有効化
      (名前や名前や画面の裏で参加者を識別するために使います。
       ログイン画面は出ません、自動でサインインされます)
   4. プロジェクト設定 → 「マイアプリ」→ ウェブアプリを追加
      → 表示される firebaseConfig の値を下にコピーしてください
   5. Firestore の「ルール」タブに以下を貼り付けて公開:

      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {
          match /rooms/{roomId} {
            allow read: if request.auth != null;
            allow create: if request.auth != null
              && request.resource.data.hostUid == request.auth.uid
              && request.resource.data.status == "waiting";
            allow update: if request.auth != null;
            allow delete: if request.auth != null;

            match /players/{playerId} {
              allow read: if request.auth != null;
              // 自分のプレイヤードキュメントだけ作成・更新できる
              allow create: if request.auth != null && request.auth.uid == playerId;
              allow update: if request.auth != null;
              allow delete: if request.auth != null;
            }

            match /history/{entryId} {
              allow read: if request.auth != null;
              allow create: if request.auth != null;
              allow update: if request.auth != null;
              allow delete: if request.auth != null;
            }

            match /customTemplates/{templateId} {
              allow read: if request.auth != null;
              allow create: if request.auth != null;
              allow delete: if request.auth != null;
            }
          }
        }
      }

      ※ このゲームは「身内の飲み会で使う」前提の簡易ルールです。
        部屋コードさえ知っていれば誰でも読み書きできてしまう構造は変わらないため、
        機密情報は入れないでください。上記は最低限の悪戯防止(他人のプレイヤー
        ドキュメントへのなりすまし作成を防ぐ、など)を加えたものです。

   【期限切れルームの自動削除について】
   このコードは「join時にブロックする」「クライアントが検知したら削除する」という
   簡易的な対処のみを行っています。より確実に自動削除したい場合は、Firestoreの
   TTL(Time-to-live)ポリシーを使うのがおすすめです:
     1. Firebase コンソール → Firestore Database → 「TTL」タブ
     2. コレクショングループ「rooms」に対して、フィールド「createdAt」を指定
     3. 有効化すると、作成から一定時間後にドキュメントが自動削除される
        (players/history などのサブコレクションは別途 Cloud Functions での
         削除が必要になる場合があります)
   ========================================================== */

const KING_GAME_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCFHcgn-W7SZuEYFeKBHK4O_GYYoR9ztM8",
  authDomain: "king-s-game-69946.firebaseapp.com",
  projectId: "king-s-game-69946",
  storageBucket: "king-s-game-69946.firebasestorage.app",
  messagingSenderId: "77028177674",
  appId: "1:77028177674:web:7b2fb2f29323c25e0a2cf3"
};