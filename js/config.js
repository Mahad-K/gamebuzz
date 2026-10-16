// ====================================================
//  🔥 FIREBASE CONFIGURATION
//  Replace the placeholder values below with your own.
//
//  Steps:
//  1. Go to https://console.firebase.google.com
//  2. Create a new project (or use an existing one)
//  3. Add a Web App to the project
//  4. Enable Realtime Database (Build → Realtime Database)
//     → Choose a region → Start in TEST MODE for now
//  5. Copy the config object from Project Settings → Your apps → SDK setup
//  6. Paste the values here
// ====================================================

export const firebaseConfig = {

  apiKey: "AIzaSyDIGYpcAgcgxK2yfDR_t_7KcEm1JdeHV5I",

  authDomain: "gamebuzz-trivia.firebaseapp.com",

  databaseURL: "https://gamebuzz-trivia-default-rtdb.firebaseio.com",

  projectId: "gamebuzz-trivia",

  storageBucket: "gamebuzz-trivia.firebasestorage.app",

  messagingSenderId: "35680719294",

  appId: "1:35680719294:web:b958224ffef9e06d61a9ef",

  measurementId: "G-6Z7NZGLF1D"

};


// ====================================================
//  GAME SETTINGS (tweak if you like)
// ====================================================
export const SETTINGS = {
  ANSWER_TIME_SEC: 20,       // seconds to answer each question
  REVEAL_TIME_SEC: 4,        // seconds to show correct answer
  POINTS_CORRECT: 100,       // points for a correct answer
  POINTS_FIRST_BONUS: 50,    // bonus points for first correct answer
  MIN_PLAYERS: 2,            // minimum players to start
  MAX_PLAYERS: 10,           // maximum players per room
  MIN_QUESTIONS: 5,          // host can pick min questions
  MAX_QUESTIONS: 30,         // host can pick max questions
  DEFAULT_QUESTIONS: 10,     // default question count
  ROOM_EXPIRY_MS: 3600000,   // 1 hour — rooms auto-clean after this
};
