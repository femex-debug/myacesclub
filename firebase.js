// ── Firebase Setup — ACES Club Inc. ──
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, getDoc, getDocs, deleteDoc,
  onSnapshot, query, orderBy, where, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBUTat80RVdSfL-XZXQ6vCzmEK-lpnviuw",
  authDomain: "aces-club-leaderboard.firebaseapp.com",
  projectId: "aces-club-leaderboard",
  storageBucket: "aces-club-leaderboard.firebasestorage.app",
  messagingSenderId: "25277020528",
  appId: "1:25277020528:web:280d765a8fbdad4a4ef7b5",
  measurementId: "G-CGYQCR47MB"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db, collection, doc, addDoc, setDoc, updateDoc, getDoc, getDocs, deleteDoc, onSnapshot, query, orderBy, where, limit };
