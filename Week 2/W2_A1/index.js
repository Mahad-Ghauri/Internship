const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./openapi.json');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

const INITIAL_TASKS = [
  { id: 1, title: "Buy groceries", done: false },
  { id: 2, title: "Read a book", done: true },
  { id: 3, title: "Complete coding assignment", done: false }
];

let tasks = INITIAL_TASKS.map(t => ({ ...t }));

app.get('/', (req, res) => {
  res.json({ name: "Task API", version: "1.0", endpoints: ["/tasks"] });
});

app.get('/health', (req, res) => {
  res.json({ status: "ok" });
});

app.get('/tasks', (req, res) => {
  let filteredTasks = [...tasks];

  // Done filtering
  if (req.query.done !== undefined) {
    const isDone = req.query.done === 'true';
    filteredTasks = filteredTasks.filter(t => t.done === isDone);
  }

  // Search filtering
  if (req.query.search !== undefined) {
    const queryStr = req.query.search.toLowerCase();
    filteredTasks = filteredTasks.filter(t => t.title.toLowerCase().includes(queryStr));
  }

  // Pagination (limit and offset)
  const limit = parseInt(req.query.limit, 10);
  const offset = parseInt(req.query.offset, 10);

  if (!isNaN(offset)) {
    filteredTasks = filteredTasks.slice(offset);
  }
  if (!isNaN(limit)) {
    filteredTasks = filteredTasks.slice(0, limit);
  }

  res.json(filteredTasks);
});

app.get('/tasks/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const task = tasks.find(t => t.id === id);
  if (!task) {
    return res.status(404).json({ error: `Task ${req.params.id} not found` });
  }
  res.json(task);
});

app.post('/tasks', (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== 'string' || title.trim() === '') {
    return res.status(400).json({ error: "Title is required and must be a non-empty string" });
  }

  const nextId = tasks.length > 0 ? Math.max(...tasks.map(t => t.id)) + 1 : 1;
  const newTask = {
    id: nextId,
    title: title.trim(),
    done: false
  };

  tasks.push(newTask);
  res.status(201).json(newTask);
});

app.put('/tasks/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const task = tasks.find(t => t.id === id);
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

  if (title !== undefined) {
    task.title = title.trim();
  }
  if (done !== undefined) {
    task.done = done;
  }

  res.json(task);
});

app.delete('/tasks/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const taskIndex = tasks.findIndex(t => t.id === id);
  if (taskIndex === -1) {
    return res.status(404).json({ error: `Task ${req.params.id} not found` });
  }

  tasks.splice(taskIndex, 1);
  res.status(204).send();
});

app.get('/stats', (req, res) => {
  const total = tasks.length;
  const done = tasks.filter(t => t.done).length;
  const open = total - done;
  res.json({ total, done, open });
});

app.post('/reset', (req, res) => {
  tasks = INITIAL_TASKS.map(t => ({ ...t }));
  res.json({ message: "Database reset to initial tasks." });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
