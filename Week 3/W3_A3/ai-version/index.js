const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());

// SQLite setup
const db = new Database(path.join(__dirname, 'tasks.db'));

// Create table if missing
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    done INTEGER DEFAULT 0
  )
`);

// Seed initial tasks if empty
const count = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
if (count === 0) {
  const insert = db.prepare('INSERT INTO tasks (title, done) VALUES (?, ?)');
  insert.run("Buy groceries", 0);
  insert.run("Read a book", 1);
  insert.run("Complete coding assignment", 0);
}

// Endpoints
app.get('/tasks', (req, res) => {
  try {
    let rows = db.prepare('SELECT * FROM tasks').all();
    
    // JS filtering instead of SQL filtering
    let results = rows.map(r => ({ id: r.id, title: r.title, done: !!r.done }));
    
    if (req.query.done !== undefined) {
      const isDone = req.query.done === 'true';
      results = results.filter(t => t.done === isDone);
    }
    if (req.query.search !== undefined) {
      const searchStr = req.query.search.toLowerCase();
      results = results.filter(t => t.title.toLowerCase().includes(searchStr));
    }
    
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/tasks/:id', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!row) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ id: row.id, title: row.title, done: !!row.done });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/tasks', (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== 'string' || title.trim() === '') {
    return res.status(400).json({ error: 'Title is required' });
  }
  try {
    const info = db.prepare('INSERT INTO tasks (title, done) VALUES (?, 0)').run(title.trim());
    res.status(201).json({ id: info.lastInsertRowid, title: title.trim(), done: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/tasks/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { title, done } = req.body;
  
  if (title === undefined && done === undefined) {
    return res.status(400).json({ error: 'Title or done status required' });
  }
  
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const nextTitle = title !== undefined ? title.trim() : task.title;
    const nextDone = done !== undefined ? (done ? 1 : 0) : task.done;
    
    db.prepare('UPDATE tasks SET title = ?, done = ? WHERE id = ?').run(nextTitle, nextDone, id);
    res.json({ id, title: nextTitle, done: nextDone === 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/tasks/:id', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`AI version running on port ${PORT}`);
});
