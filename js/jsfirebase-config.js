const firebaseConfig = {
  apiKey: "AIzaSyCJE352PnCkTWoxcoLzK9gT0THrv_UMo-M",
  authDomain: "ai-siwes-system.firebaseapp.com",
  projectId: "ai-siwes-system",
  storageBucket: "ai-siwes-system.firebasestorage.app",
  messagingSenderId: "507546565279",
  appId: "1:507546565279:web:3ca5134647019a29da80aa"
};

firebase.initializeApp(firebaseConfig);

window.auth = firebase.auth();
window.db = firebase.firestore();

console.log("Firebase initialized successfully");