const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./openapi.json');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Open SQLite database file (will create if it does not exist)
const dbPath = path.join(__dirname, 'tasks.db');
const db = new Database(dbPath);

// Create table and indexes, and seed initial tasks inside a single transaction (Stage 0)
const initializeDatabase = db.transaction(() => {
  // Create tasks table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      done INTEGER DEFAULT 0
    )
  `).run();

  // Add indexes to optimize searches and filters
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_tasks_title ON tasks(title)`).run();

  // Seed tasks only if the table is empty
  const rowCount = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
  if (rowCount === 0) {
    const insertStmt = db.prepare('INSERT INTO tasks (title, done) VALUES (?, ?)');
    insertStmt.run("Buy groceries", 0);
    insertStmt.run("Read a book", 1);
    insertStmt.run("Complete coding assignment", 0);
  }
});

// Run DB Initialization
initializeDatabase();

app.get('/', (req, res) => {
  res.json({ name: "Task API", version: "1.0", endpoints: ["/tasks"] });
});

app.get('/health', (req, res) => {
  res.json({ status: "ok" });
});

// GET /tasks: Retrieve tasks with SQL filtering, search, sorting, and pagination (Stage 1 & Extras)
app.get('/tasks', (req, res) => {
  let query = 'SELECT * FROM tasks';
  const conditions = [];
  const params = [];

  // Done status filter
  if (req.query.done !== undefined) {
    const isDone = req.query.done === 'true' ? 1 : 0;
    conditions.push('done = ?');
    params.push(isDone);
  }

  // Keyword search filter (using LIKE operator)
  if (req.query.search !== undefined) {
    conditions.push('title LIKE ?');
    params.push(`%${req.query.search}%`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  // Alphabetical sort filter (using ORDER BY title)
  if (req.query.sort === 'title' || req.query.sort === 'alphabetical') {
    query += ' ORDER BY title ASC';
  } else {
    query += ' ORDER BY id ASC';
  }

  // Pagination support (using LIMIT and OFFSET)
  const limit = parseInt(req.query.limit, 10);
  const offset = parseInt(req.query.offset, 10);

  if (!isNaN(limit)) {
    query += ' LIMIT ?';
    params.push(limit);
    if (!isNaN(offset)) {
      query += ' OFFSET ?';
      params.push(offset);
    }
  } else if (!isNaN(offset)) {
    // SQLite requires a LIMIT to be present if OFFSET is specified
    query += ' LIMIT -1 OFFSET ?';
    params.push(offset);
  }

  try {
    const rows = db.prepare(query).all(...params);
    // Map integers back to standard boolean flags
    const result = rows.map(row => ({
      id: row.id,
      title: row.title,
      done: row.done === 1
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /tasks/:id: Retrieve a single task by ID (Stage 1)
app.get('/tasks/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid task ID" });
  }

  try {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!row) {
      return res.status(404).json({ error: `Task ${req.params.id} not found` });
    }
    res.json({
      id: row.id,
      title: row.title,
      done: row.done === 1
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /tasks: Create a new task (Stage 2)
app.post('/tasks', (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== 'string' || title.trim() === '') {
    return res.status(400).json({ error: "Title is required and must be a non-empty string" });
  }

  const trimmedTitle = title.trim();

  try {
    const info = db.prepare('INSERT INTO tasks (title, done) VALUES (?, 0)').run(trimmedTitle);
    res.status(201).json({
      id: info.lastInsertRowid,
      title: trimmedTitle,
      done: false
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /tasks/:id: Update task title and/or done status (Stage 3)
app.put('/tasks/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid task ID" });
  }

  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!task) {
      return res.status(404).json({ error: `Task ${req.params.id} not found` });
    }

    const { title, done } = req.body;

    if (title === undefined && done === undefined) {
      return res.status(400).json({ error: "At least one of 'title' or 'done' must be provided" });
    }

    if (title !== undefined && (typeof title !== 'string' || title.trim() === '')) {
      return res.status(400).json({ error: "Title must be a non-empty string" });
    }

    if (done !== undefined && typeof done !== 'boolean') {
      return res.status(400).json({ error: "Done must be a boolean" });
    }

    const finalTitle = title !== undefined ? title.trim() : task.title;
    const finalDone = done !== undefined ? (done ? 1 : 0) : task.done;

    db.prepare('UPDATE tasks SET title = ?, done = ? WHERE id = ?').run(finalTitle, finalDone, id);

    res.json({
      id: id,
      title: finalTitle,
      done: finalDone === 1
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /tasks/:id: Delete a task by ID (Stage 3)
app.delete('/tasks/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid task ID" });
  }

  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!task) {
      return res.status(404).json({ error: `Task ${req.params.id} not found` });
    }

    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /stats: Retrieve statistics computed directly in SQL (Extras)
app.get('/stats', (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END) as done
      FROM tasks
    `).get();

    const total = stats.total || 0;
    const done = stats.done || 0;
    const open = total - done;

    res.json({ total, done, open });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /reset: Clear and re-seed database using transactions (Extras)
app.post('/reset', (req, res) => {
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM tasks').run();
      db.prepare("DELETE FROM sqlite_sequence WHERE name='tasks'").run(); // Reset primary key counter
      
      const insertStmt = db.prepare('INSERT INTO tasks (title, done) VALUES (?, ?)');
      insertStmt.run("Buy groceries", 0);
      insertStmt.run("Read a book", 1);
      insertStmt.run("Complete coding assignment", 0);
    })();
    res.json({ message: "Database reset to initial tasks." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clean shut down
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
