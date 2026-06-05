# 🎰 Golden Casino

[한국어](README.md) | [English](README.en.md)

![Project Status](https://img.shields.io/badge/status-reference-lightgrey.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-gold.svg)

**Golden Casino** is a premium, web-based Baccarat game platform featuring real-time multiplayer gameplay, a robust financial system (deposit/withdrawal), and a comprehensive admin dashboard. Designed with a luxury "Dark & Gold" aesthetic, it provides an immersive experience for players and powerful tools for operators.

> This is a public portfolio and learning demo. It does not provide real-money gambling, deposits, withdrawals, or betting services.

---

### 📖 Platform Overview

Golden Casino replicates the excitement of a real Baccarat table. It supports meaningful interactions between players via chat and money transfers ("Gratuity" / "Fan"), while administrators maintain full control over the game flow and economy.

### ✨ Key Features

#### 👤 User (Player) Features

- **Real-Time Gameplay**:
  - Live Baccarat logic with standard rules (Player, Banker, Tie, Pairs).
  - Real-time synchronization of game state and results using Socket.IO.
  - Immersive sound effects for betting, winning, and background ambience.
- **Financial System**:
  - **Deposit & Withdrawal**: Request coin charging/exchanging with a visually appealing history log.
  - **Peer-to-Peer Transfer**: Send coins to other players (User-to-User transfer system).
  - **Rolling System**: Tracks wagering requirements for withdrawals.
- **Community & Social**:
  - **Live Chat**: Real-time chat with admin announcements and highlight modes.
  - **Leaderboard**: Live ranking based on coin balance and win rates.
  - **My Page**: Detailed betting history and personal statistics.

#### 🛡️ Admin Features

- **Dashboard**:
  - Real-time overview of connected users and active bets.
  - **House Statistics**: View total bets, house edge profit, and overall financial health.
- **User Management**:
  - Approve new registrations.
  - Reset user passwords and delete accounts.
  - Grant/Revoke Admin privileges.
  - **Manual Balance Adjustment**: Add or deduct coins from specific users instantly.
- **Game Management**:
  - **Auto Game Mode**: Set a specific number of rounds to play automatically.
  - **Message Bar**: Broadcast urgent notices or highlighted messages to all connected users.

### 🛠️ Tech Stack

| Category      | Technology        | Description                                        |
| ------------- | ----------------- | -------------------------------------------------- |
| **Frontend**  | HTML5, Vanilla JS | Lightweight, standard web technologies.            |
| **Styling**   | Tailwind CSS      | Utility-first CSS for rapid, responsive UI design. |
| **Backend**   | Node.js, Express  | Scalable server-side logic.                        |
| **Database**  | MongoDB, Mongoose | Flexible data schema for users and logs.           |
| **Real-time** | Socket.IO         | Bi-directional communication for game state.       |
| **Security**  | JWT, bcryptjs     | Authentication and password hashing.               |

### 📂 Project Structure

```bash
Golden_Casino/
├── golden_casino_backend/      # Server-side Code
│   ├── server.js               # Main server logic (API & Socket)
│   ├── package.json            # Dependencies
│   └── .env                    # Environment variables (Configuration)
└── golden_casino_frontend/     # Client-side Code
    ├── index.html              # Login & Landing Page
    ├── register.html           # User Registration Page
    ├── user.html               # Main Game Interface for Players
    ├── user.js                 # Player Game Logic
    ├── admin.html              # Admin Dashboard Interface
    ├── admin.js                # Administrator Logic
    └── assets/                 # Images, Sounds (.mp3), Fonts
```

### 🚀 Installation & Setup

#### 1. Prerequisites

- **Node.js**: v14.x or higher.
- **MongoDB**: Local installation or MongoDB Atlas URI.

#### 2. Backend Setup

Navigate to the backend directory and install dependencies.

```bash
cd golden_casino_backend
npm install
```

Create a `.env` file in the `golden_casino_backend` root directory.

```env
# .env file configuration
JWT_SECRET=your_super_secret_key_change_this
MONGO_URI=mongodb://localhost:27017/betting_game
FRONTEND_URL=http://127.0.0.1:5500
PORT=5000
```

Start the server.

```bash
npm start
# or for development
node server.js
```

#### 3. Frontend Setup

Since the frontend is static, you need to serve it using a local web server to avoid CORS issues.

- **Using VS Code Live Server**: Right-click `index.html` and select "Open with Live Server".
- **Using Python**: `python -m http.server 5500` inside `golden_casino_frontend`.

Access the app at: `http://127.0.0.1:5500`

### 📝 API Documentation (Brief)

| Method | Endpoint                            | Description                         | Auth Required |
| :----: | ----------------------------------- | ----------------------------------- | :-----------: |
| `POST` | `/api/auth/register`                | Register a new user account.        |      ❌       |
| `POST` | `/api/auth/login`                   | Login and receive JWT token.        |      ❌       |
| `GET`  | `/api/auth/user-info`               | Get current logged-in user details. |      ✅       |
| `GET`  | `/api/admin/users`                  | List all registered users.          |  ✅ (Admin)   |
| `PUT`  | `/api/admin/users/:id/approve`      | Approve a pending user.             |  ✅ (Admin)   |
| `PUT`  | `/api/admin/users/:id/adjust-coins` | Manually change user balance.       |  ✅ (Admin)   |

---

Released under the MIT License. See [LICENSE](./LICENSE).
