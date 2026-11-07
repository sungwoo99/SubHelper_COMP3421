// server.js
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs'); // adding file system module

const app = express();
const PORT = process.env.PORT || 3000;

// set up middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// Prevent infinite restart on Glitch by creating a special hidden folder (.data) and connecting to the database
const dbDir = './.data';
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir);
}

const db = new sqlite3.Database('./.data/database.db', (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to the SQLite database in .data folder.');
    initializeDB();
  }
});

// DB 테이블 초기화 및 자동 더미 데이터 삽입 (Database Seeding)
function initializeDB() {
  db.serialize(() => {
    // 1. 테이블 생성
    db.run(`CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      categoryName TEXT NOT NULL,
      monthlyCap REAL NOT NULL,
      alertThreshold INTEGER NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      billingCycle TEXT NOT NULL,
      cost REAL NOT NULL,
      nextRenewalDate TEXT NOT NULL,
      isActive INTEGER NOT NULL,
      notes TEXT
    )`);

    // 2. Budgets 테이블이 비어있으면 자동 데이터(Seed) 주입
    db.get("SELECT COUNT(*) AS count FROM budgets", (err, row) => {
      if (row && row.count === 0) {
        console.log("Empty DB detected. Seeding initial Budget data...");
        const insertBudget = db.prepare(`INSERT INTO budgets (id, categoryName, monthlyCap, alertThreshold) VALUES (?, ?, ?, ?)`);
        insertBudget.run("b_1", "Entertainment", 50, 80);
        insertBudget.run("b_2", "Productivity", 100, 90);
        insertBudget.run("b_3", "Utilities", 150, 85);
        insertBudget.run("b_4", "Health", 80, 80);
        insertBudget.finalize();
      }
    });

    // 3. Subscriptions 테이블이 비어있으면 자동 데이터(Seed) 주입
    db.get("SELECT COUNT(*) AS count FROM subscriptions", (err, row) => {
      if (row && row.count === 0) {
        console.log("Seeding initial Subscription data...");
        // 날짜를 시연일 기준(오늘부터 며칠 뒤)으로 동적 생성하여 항상 D-Day가 적절하게 보이도록 처리
        const today = new Date();
        const getFutureDate = (days) => {
          const d = new Date(today);
          d.setDate(d.getDate() + days);
          return d.toISOString().split("T")[0];
        };

        const insertSub = db.prepare(`INSERT INTO subscriptions (id, name, category, billingCycle, cost, nextRenewalDate, isActive, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        
        // Entertainment
        insertSub.run("sub_1", "Netflix Premium", "Entertainment", "monthly", 15.99, getFutureDate(3), 1, "Family shared account");
        insertSub.run("sub_2", "Spotify", "Entertainment", "monthly", 10.99, getFutureDate(10), 1, "Student discount applied");
        insertSub.run("sub_3", "Disney+", "Entertainment", "yearly", 109.99, getFutureDate(45), 1, "Annual plan");
        
        // Productivity
        insertSub.run("sub_4", "Adobe Creative Cloud", "Productivity", "monthly", 54.99, getFutureDate(5), 1, "All Apps plan");
        insertSub.run("sub_5", "GitHub Copilot", "Productivity", "monthly", 10.00, getFutureDate(12), 1, "");
        insertSub.run("sub_6", "Notion AI", "Productivity", "monthly", 8.00, getFutureDate(20), 0, "Paused for now"); // Paused 데이터 예시
        
        // Utilities & Health
        insertSub.run("sub_7", "Google One", "Utilities", "monthly", 9.99, getFutureDate(2), 1, "2TB Storage");
        insertSub.run("sub_8", "Anytime Fitness", "Health", "monthly", 45.00, getFutureDate(8), 1, "Local gym membership");
        
        insertSub.finalize();
      }
    });
  });
}

/* ==========================================================================
   RESTful API Endpoints
   ========================================================================== */

// 1. Budgets API
app.get('/api/budgets', (req, res) => {
  db.all(`SELECT * FROM budgets`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/budgets', (req, res) => {
  const { id, categoryName, monthlyCap, alertThreshold } = req.body;
  const sql = `INSERT INTO budgets (id, categoryName, monthlyCap, alertThreshold) VALUES (?, ?, ?, ?)`;
  db.run(sql, [id, categoryName, monthlyCap, alertThreshold], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Budget created successfully', id });
  });
});

app.put('/api/budgets/:id', (req, res) => {
  const { categoryName, monthlyCap, alertThreshold } = req.body;
  const sql = `UPDATE budgets SET categoryName = ?, monthlyCap = ?, alertThreshold = ? WHERE id = ?`;
  db.run(sql, [categoryName, monthlyCap, alertThreshold, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Budget updated successfully' });
  });
});

app.delete('/api/budgets/:id', (req, res) => {
  db.run(`DELETE FROM budgets WHERE id = ?`, req.params.id, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Budget deleted successfully' });
  });
});

// 2. Subscriptions API
app.get('/api/subscriptions', (req, res) => {
  db.all(`SELECT * FROM subscriptions`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    // SQLite does not have a Boolean type, so it is stored as an integer (1/0) and converted when sending to the client
    const formattedRows = rows.map(r => ({ ...r, isActive: r.isActive === 1 }));
    res.json(formattedRows);
  });
});

app.post('/api/subscriptions', (req, res) => {
  const { id, name, category, billingCycle, cost, nextRenewalDate, isActive, notes } = req.body;
  const activeInt = isActive ? 1 : 0; // Boolean -> Integer
  const sql = `INSERT INTO subscriptions (id, name, category, billingCycle, cost, nextRenewalDate, isActive, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(sql, [id, name, category, billingCycle, cost, nextRenewalDate, activeInt, notes], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Subscription created successfully', id });
  });
});

app.put('/api/subscriptions/:id', (req, res) => {
  const { name, category, billingCycle, cost, nextRenewalDate, isActive, notes } = req.body;
  const activeInt = isActive ? 1 : 0;
  const sql = `UPDATE subscriptions SET name = ?, category = ?, billingCycle = ?, cost = ?, nextRenewalDate = ?, isActive = ?, notes = ? WHERE id = ?`;
  db.run(sql, [name, category, billingCycle, cost, nextRenewalDate, activeInt, notes, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Subscription updated successfully' });
  });
});

app.delete('/api/subscriptions/:id', (req, res) => {
  db.run(`DELETE FROM subscriptions WHERE id = ?`, req.params.id, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Subscription deleted successfully' });
  });
});

// Basic route
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});