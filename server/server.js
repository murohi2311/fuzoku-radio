const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

// データベースの初期化
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('データベース接続エラー:', err.message);
  } else {
    console.log('データベースに接続しました');
  }
});

// テーブルの作成
db.serialize(() => {
  // テーマテーブル
  db.run(`CREATE TABLE IF NOT EXISTS themes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,    start_date DATE,
    end_date DATE,    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER DEFAULT 1
  )`);

  // お便りテーブル
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_name TEXT,
    radio_name TEXT NOT NULL,
    school_class TEXT,
    theme_id INTEGER,
    content TEXT NOT NULL,
    share_name INTEGER DEFAULT 0,
    share_class INTEGER DEFAULT 0,
    share_theme INTEGER DEFAULT 0,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_read INTEGER DEFAULT 0,
    FOREIGN KEY (theme_id) REFERENCES themes (id)
  )`);

  // 広報部員用URLトークンテーブル（シングルトークン方式）
  db.run(`CREATE TABLE IF NOT EXISTS access_token (
    id INTEGER PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER DEFAULT 1
  )`);
});

// ミドルウェア
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// ================== API エンドポイント ==================

// 【教員用】現在のトークンを取得
app.get('/api/teacher/get-current-token', (req, res) => {
  db.get(
    'SELECT * FROM access_token WHERE is_active = 1 LIMIT 1',
    [],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'トークン取得に失敗しました' });
      }
      if (row) {
        const url = `${req.protocol}://${req.get('host')}/staff.html?token=${row.token}`;
        res.json({ url, token: row.token });
      } else {
        res.json({ url: null, token: null });
      }
    }
  );
});

// 【教員用】広報部員用URLの生成（シングルトークン方式）
app.post('/api/teacher/generate-url', (req, res) => {
  const token = uuidv4();

  // 既存のトークンがあれば削除
  db.run('DELETE FROM access_token', [], (err) => {
    if (err) {
      return res.status(500).json({ error: 'URL生成に失敗しました' });
    }
    
    // 新しいトークンを挿入
    db.run(
      'INSERT INTO access_token (token, is_active) VALUES (?, ?)',
      [token, 1],
      function (err) {
        if (err) {
          return res.status(500).json({ error: 'URL生成に失敗しました' });
        }
        const url = `${req.protocol}://${req.get('host')}/staff.html?token=${token}`;
        res.json({ url, token });
      }
    );
  });
});

// トークンの検証
app.get('/api/verify-token/:token', (req, res) => {
  const { token } = req.params;
  
  db.get(
    'SELECT * FROM access_token WHERE token = ? AND is_active = 1',
    [token],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'トークン検証エラー' });
      }
      if (!row) {
        return res.status(401).json({ valid: false, message: '無効なトークンです' });
      }
      
      res.json({ valid: true });
    }
  );
});

// 【広報部員用】テーマの取得
app.get('/api/staff/themes', (req, res) => {
  db.all(
    'SELECT * FROM themes WHERE is_active = 1 ORDER BY created_at DESC',
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'テーマ取得に失敗しました' });
      }
      res.json(rows);
    }
  );
});

// 【広報部員用】テーマの作成
app.post('/api/staff/themes', (req, res) => {
  const { title, description, start_date, end_date } = req.body;
  
  if (!title) {
    return res.status(400).json({ error: 'テーマのタイトルは必須です' });
  }
  
  db.run(
    'INSERT INTO themes (title, description, start_date, end_date) VALUES (?, ?, ?, ?)',
    [title, description, start_date || null, end_date || null],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'テーマ作成に失敗しました' });
      }
      res.json({ id: this.lastID, title, description, start_date, end_date });
    }
  );
});

// 【広報部員用】テーマの削除（非アクティブ化）
app.delete('/api/staff/themes/:id', (req, res) => {
  const { id } = req.params;
  
  db.run(
    'UPDATE themes SET is_active = 0 WHERE id = ?',
    [id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'テーマ削除に失敗しました' });
      }
      res.json({ success: true });
    }
  );
});

// 【広報部員用】お便り一覧の取得
app.get('/api/staff/messages', (req, res) => {
  db.all(
    `SELECT m.*, t.title as theme_title 
     FROM messages m 
     LEFT JOIN themes t ON m.theme_id = t.id 
     ORDER BY m.created_at DESC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'お便り取得に失敗しました' });
      }
      res.json(rows);
    }
  );
});

// 【広報部員用】お便りの既読化
app.put('/api/staff/messages/:id/read', (req, res) => {
  const { id } = req.params;
  
  db.run(
    'UPDATE messages SET is_read = 1 WHERE id = ?',
    [id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: '既読化に失敗しました' });
      }
      res.json({ success: true });
    }
  );
});

// 【生徒用】アクティブなテーマの取得（期間内のみ）
app.get('/api/student/themes', (req, res) => {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD形式の今日の日付
  
  db.all(
    `SELECT * FROM themes 
     WHERE is_active = 1 
     AND (start_date IS NULL OR start_date <= ?)
     AND (end_date IS NULL OR end_date >= ?)
     ORDER BY created_at DESC`,
    [today, today],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'テーマ取得に失敗しました' });
      }
      res.json(rows);
    }
  );
});

// 【生徒用】お便りの送信
app.post('/api/student/messages', (req, res) => {
  const { sender_name, radio_name, school_year, school_class, theme_id, content, share_name, share_class, share_theme } = req.body;
  
  if (!radio_name || !content) {
    return res.status(400).json({ error: 'ラジオネームとお便り内容は必須です' });
  }
  
  // IPアドレスを取得
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress;
  
  // 学年とクラスを組み合わせる
  const fullClass = (school_year && school_class) ? `${school_year}年${school_class}組` : null;
  
  db.run(
    'INSERT INTO messages (sender_name, radio_name, school_class, theme_id, content, share_name, share_class, share_theme, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [sender_name || null, radio_name, fullClass, theme_id, content, share_name ? 1 : 0, share_class ? 1 : 0, share_theme ? 1 : 0, ip],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'お便り送信に失敗しました' });
      }
      res.json({ 
        success: true,
        id: this.lastID,
        message: 'お便りを送信しました'
      });
    }
  );
});

// 【教員用】お便り送信ログの取得
app.get('/api/teacher/logs', (req, res) => {
  db.all(
    `SELECT m.id, m.sender_name, m.radio_name, m.school_class, m.content, m.ip_address, m.created_at, t.title as theme_title
     FROM messages m 
     LEFT JOIN themes t ON m.theme_id = t.id 
     ORDER BY m.created_at DESC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'ログ取得に失敗しました' });
      }
      res.json(rows);
    }
  );
});

// ================== HTMLページのルーティング ==================

// 教員用画面
app.get('/teacher', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/teacher.html'));
});

// 広報部員用画面
app.get('/staff', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/staff.html'));
});

// 生徒用画面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/student.html'));
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`サーバーが起動しました: http://localhost:${PORT}`);
  console.log(`教員用画面: http://localhost:${PORT}/teacher`);
  console.log(`生徒用画面: http://localhost:${PORT}/`);
});

// クリーンアップ
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('データベース接続を閉じました');
    process.exit(0);
  });
});
