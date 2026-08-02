const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./openapi.json');
const { Pool } = require('pg');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Create Postgres connection pool using connection string from environment
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initializeDatabase() {
  const maxRetries = 10;
  let retries = 0;
  let client;

  while (retries < maxRetries) {
    try {
      client = await pool.connect();
      break;
    } catch (err) {
      retries++;
      console.log(`Database connection attempt ${retries} failed. Retrying in 2 seconds...`);
      if (retries >= maxRetries) {
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  try {
    await client.query('BEGIN');

    // Create tasks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        done BOOLEAN DEFAULT FALSE
      )
    `);

    // Add indexes to optimize searches and filters
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_title ON tasks(title)`);

    // Seed tasks only if the table is empty
    const res = await client.query('SELECT COUNT(*) as count FROM tasks');
    const rowCount = parseInt(res.rows[0].count, 10);
    if (rowCount === 0) {
      await client.query('INSERT INTO tasks (title, done) VALUES ($1, $2)', ["Buy groceries", false]);
      await client.query('INSERT INTO tasks (title, done) VALUES ($1, $2)', ["Read a book", true]);
      await client.query('INSERT INTO tasks (title, done) VALUES ($1, $2)', ["Complete coding assignment", false]);
    }

    await client.query('COMMIT');
    console.log("Database initialized and seeded successfully.");
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
    }
    throw err;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Run DB Initialization
initializeDatabase().catch(err => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});

app.get('/', (req, res) => {
  res.json({ name: "Task API", version: "1.0", endpoints: ["/tasks"] });
});

// GET /health: Database-backed health check (Extras)
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: "ok", db: "ok" });
  } catch (err) {
    res.status(500).json({ status: "error", error: err.message });
  }
});

// GET /tasks: Retrieve tasks with SQL filtering, search, sorting, and pagination (Stage 1 & Extras)
app.get('/tasks', async (req, res) => {
  let query = 'SELECT * FROM tasks';
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  // Done status filter
  if (req.query.done !== undefined) {
    const isDone = req.query.done === 'true';
    conditions.push(`done = $${paramIdx++}`);
    params.push(isDone);
  }

  // Keyword search filter (using LIKE operator)
  if (req.query.search !== undefined) {
    conditions.push(`title LIKE $${paramIdx++}`);
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
    query += ` LIMIT $${paramIdx++}`;
    params.push(limit);
  }
  if (!isNaN(offset)) {
    query += ` OFFSET $${paramIdx++}`;
    params.push(offset);
  }

  try {
    const result = await pool.query(query, params);
    const mappedRows = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      done: row.done
    }));
    res.json(mappedRows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /tasks/:id: Retrieve a single task by ID (Stage 1)
app.get('/tasks/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid task ID" });
  }

  try {
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    const row = result.rows[0];
    res.json({
      id: row.id,
      title: row.title,
      done: row.done
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /tasks: Create a new task (Stage 2)
app.post('/tasks', async (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== 'string' || title.trim() === '') {
    return res.status(400).json({ error: "Title is required and must be a non-empty string" });
  }

  const trimmedTitle = title.trim();

  try {
    const result = await pool.query(
      'INSERT INTO tasks (title, done) VALUES ($1, false) RETURNING *',
      [trimmedTitle]
    );
    const newRow = result.rows[0];
    res.status(201).json({
      id: newRow.id,
      title: newRow.title,
      done: newRow.done
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /tasks/:id: Update task title and/or done status (Stage 3)
app.put('/tasks/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid task ID" });
  }

  try {
    const checkResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    const task = checkResult.rows[0];

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
    const finalDone = done !== undefined ? done : task.done;

    const updateResult = await pool.query(
      'UPDATE tasks SET title = $1, done = $2 WHERE id = $3 RETURNING *',
      [finalTitle, finalDone, id]
    );
    const updatedRow = updateResult.rows[0];
    res.json({
      id: updatedRow.id,
      title: updatedRow.title,
      done: updatedRow.done
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /tasks/:id: Delete a task by ID (Stage 3)
app.delete('/tasks/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid task ID" });
  }

  try {
    const result = await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /stats: Retrieve statistics computed directly in SQL (Extras)
app.get('/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*)::integer as total,
        SUM(CASE WHEN done = true THEN 1 ELSE 0 END)::integer as done
      FROM tasks
    `);
    const stats = result.rows[0];
    const total = stats.total || 0;
    const done = stats.done || 0;
    const open = total - done;

    res.json({ total, done, open });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /reset: Clear and re-seed database using transactions (Extras)
app.post('/reset', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE tasks RESTART IDENTITY CASCADE');
    await client.query('INSERT INTO tasks (title, done) VALUES ($1, $2)', ["Buy groceries", false]);
    await client.query('INSERT INTO tasks (title, done) VALUES ($1, $2)', ["Read a book", true]);
    await client.query('INSERT INTO tasks (title, done) VALUES ($1, $2)', ["Complete coding assignment", false]);
    await client.query('COMMIT');
    res.json({ message: "Database reset to initial tasks." });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Clean shut down
process.on('SIGINT', async () => {
  try {
    await pool.end();
    console.log("Database connection pool closed.");
  } catch (err) {
    console.error("Error closing connection pool:", err);
  } finally {
    process.exit(0);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
