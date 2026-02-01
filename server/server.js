const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

mongoose.set('strictQuery', true);

const themeSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  start_date: Date,
  end_date: Date,
  created_at: { type: Date, default: Date.now },
  is_active: { type: Boolean, default: true }
});

const messageSchema = new mongoose.Schema({
  sender_name: String,
  radio_name: { type: String, required: true },
  school_class: String,
  theme_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Theme' },
  content: { type: String, required: true },
  share_name: { type: Boolean, default: false },
  share_class: { type: Boolean, default: false },
  share_theme: { type: Boolean, default: false },
  ip_address: String,
  created_at: { type: Date, default: Date.now },
  is_read: { type: Boolean, default: false }
});

const accessTokenSchema = new mongoose.Schema({
  token: { type: String, unique: true, required: true },
  created_at: { type: Date, default: Date.now },
  is_active: { type: Boolean, default: true }
});

const Theme = mongoose.model('Theme', themeSchema);
const Message = mongoose.model('Message', messageSchema);
const AccessToken = mongoose.model('AccessToken', accessTokenSchema);

// ミドルウェア
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

const toClient = (docs) => docs.map((doc) => ({ ...doc, id: doc._id }));

// ================== API エンドポイント ==================

// 【教員用】現在のトークンを取得
app.get('/api/teacher/get-current-token', async (req, res) => {
  try {
    const row = await AccessToken.findOne({ is_active: true }).sort({ created_at: -1 }).lean();
    if (row) {
      const url = `${req.protocol}://${req.get('host')}/staff.html?token=${row.token}`;
      return res.json({ url, token: row.token });
    }
    res.json({ url: null, token: null });
  } catch (err) {
    console.error('トークン取得エラー:', err);
    res.status(500).json({ error: 'トークン取得に失敗しました' });
  }
});

// 【教員用】広報部員用URLの生成（シングルトークン方式）
app.post('/api/teacher/generate-url', async (req, res) => {
  const token = uuidv4();
  try {
    await AccessToken.deleteMany({});
    await AccessToken.create({ token, is_active: true });
    const url = `${req.protocol}://${req.get('host')}/staff.html?token=${token}`;
    res.json({ url, token });
  } catch (err) {
    console.error('URL生成エラー:', err);
    res.status(500).json({ error: 'URL生成に失敗しました' });
  }
});

// トークンの検証
app.get('/api/verify-token/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const row = await AccessToken.findOne({ token, is_active: true }).lean();
    if (!row) {
      return res.status(401).json({ valid: false, message: '無効なトークンです' });
    }
    res.json({ valid: true });
  } catch (err) {
    console.error('トークン検証エラー:', err);
    res.status(500).json({ error: 'トークン検証エラー' });
  }
});

// 【広報部員用】テーマの取得
app.get('/api/staff/themes', async (req, res) => {
  try {
    const themes = await Theme.find({ is_active: true }).sort({ created_at: -1 }).lean();
    res.json(toClient(themes));
  } catch (err) {
    console.error('テーマ取得エラー:', err);
    res.status(500).json({ error: 'テーマ取得に失敗しました' });
  }
});

// 【広報部員用】テーマの作成
app.post('/api/staff/themes', async (req, res) => {
  const { title, description, start_date, end_date } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'テーマのタイトルは必須です' });
  }

  try {
    const theme = await Theme.create({
      title,
      description,
      start_date: start_date || null,
      end_date: end_date || null
    });
    res.json({ id: theme._id, title: theme.title, description: theme.description, start_date: theme.start_date, end_date: theme.end_date });
  } catch (err) {
    console.error('テーマ作成エラー:', err);
    res.status(500).json({ error: 'テーマ作成に失敗しました' });
  }
});

// 【広報部員用】テーマの削除（非アクティブ化）
app.delete('/api/staff/themes/:id', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: '無効なIDです' });
  }

  try {
    const result = await Theme.findByIdAndUpdate(id, { is_active: false }, { new: true });
    if (!result) {
      return res.status(404).json({ error: 'テーマが見つかりません' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('テーマ削除エラー:', err);
    res.status(500).json({ error: 'テーマ削除に失敗しました' });
  }
});

// 【広報部員用】お便り一覧の取得
app.get('/api/staff/messages', async (req, res) => {
  try {
    const messages = await Message.find()
      .populate('theme_id', 'title')
      .sort({ created_at: -1 })
      .lean();

    const formatted = messages.map((m) => ({
      ...m,
      id: m._id,
      theme_title: m.theme_id ? m.theme_id.title : null,
      theme_id: m.theme_id ? m.theme_id._id : null
    }));

    res.json(formatted);
  } catch (err) {
    console.error('お便り取得エラー:', err);
    res.status(500).json({ error: 'お便り取得に失敗しました' });
  }
});

// 【広報部員用】お便りの既読化
app.put('/api/staff/messages/:id/read', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: '無効なIDです' });
  }

  try {
    await Message.findByIdAndUpdate(id, { is_read: true });
    res.json({ success: true });
  } catch (err) {
    console.error('既読化エラー:', err);
    res.status(500).json({ error: '既読化に失敗しました' });
  }
});

// 【生徒用】アクティブなテーマの取得（期間内のみ）
app.get('/api/student/themes', async (req, res) => {
  const today = new Date();

  try {
    const themes = await Theme.find({
      is_active: true,
      $and: [
        { $or: [{ start_date: null }, { start_date: { $lte: today } }] },
        { $or: [{ end_date: null }, { end_date: { $gte: today } }] }
      ]
    })
      .sort({ created_at: -1 })
      .lean();

    res.json(toClient(themes));
  } catch (err) {
    console.error('テーマ取得エラー:', err);
    res.status(500).json({ error: 'テーマ取得に失敗しました' });
  }
});

// 【生徒用】お便りの送信
app.post('/api/student/messages', async (req, res) => {
  const { sender_name, radio_name, school_year, school_class, theme_id, content, share_name, share_class, share_theme } = req.body;

  if (!radio_name || !content) {
    return res.status(400).json({ error: 'ラジオネームとお便り内容は必須です' });
  }

  let themeObjectId = null;
  if (theme_id) {
    if (!mongoose.Types.ObjectId.isValid(theme_id)) {
      return res.status(400).json({ error: 'テーマIDが不正です' });
    }
    themeObjectId = theme_id;
  }

  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress;
  const fullClass = school_year && school_class ? `${school_year}年${school_class}組` : null;

  try {
    const message = await Message.create({
      sender_name: sender_name || null,
      radio_name,
      school_class: fullClass,
      theme_id: themeObjectId,
      content,
      share_name: !!share_name,
      share_class: !!share_class,
      share_theme: !!share_theme,
      ip_address: ip
    });

    res.json({
      success: true,
      id: message._id,
      message: 'お便りを送信しました'
    });
  } catch (err) {
    console.error('お便り送信エラー:', err);
    res.status(500).json({ error: 'お便り送信に失敗しました' });
  }
});

// 【教員用】お便り送信ログの取得
app.get('/api/teacher/logs', async (req, res) => {
  try {
    const messages = await Message.find()
      .populate('theme_id', 'title')
      .sort({ created_at: -1 })
      .lean();

    const formatted = messages.map((m) => ({
      id: m._id,
      sender_name: m.sender_name,
      radio_name: m.radio_name,
      school_class: m.school_class,
      content: m.content,
      ip_address: m.ip_address,
      created_at: m.created_at,
      theme_title: m.theme_id ? m.theme_id.title : null
    }));

    res.json(formatted);
  } catch (err) {
    console.error('ログ取得エラー:', err);
    res.status(500).json({ error: 'ログ取得に失敗しました' });
  }
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

mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => {
    console.log('MongoDBに接続しました');
    app.listen(PORT, () => {
      console.log(`サーバーが起動しました: http://localhost:${PORT}`);
      console.log(`教員用画面: http://localhost:${PORT}/teacher`);
      console.log(`生徒用画面: http://localhost:${PORT}/`);
    });
  })
  .catch((err) => {
    console.error('MongoDB接続エラー:', err.message);
    process.exit(1);
  });

// クリーンアップ
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('MongoDB接続を閉じました');
  process.exit(0);
});
