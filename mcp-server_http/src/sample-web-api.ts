import express from "express";
import { todo } from "node:test";

const WEB_API_PORT = Number(process.env.WEB_API_PORT ?? "3001");


class Todo {
  id?: number;

  constructor(private title: string, private completed: boolean = false, private source: string) { }

  done(): Todo {
    this.completed = true;
    return this;
  }
}

class CustomError extends Error {
  constructor(status: number, message: string) {
    super(message);
  }
}

function boot() {
  const sampleApi = express();
  sampleApi.use(express.json());

  sampleApi.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const todos: Todo[] = [];
  const generateId = () => Math.floor(Math.random() * 1000);
  const convertId = (id: string): number => Number(id);
  const getTodo = (id: number) => {
    if (Number.isNaN(id)) return undefined;
    return todos.find((t) => t.id === id);
  };

  sampleApi.get("/todos/:id", (req, res) => {
    const todo = getTodo(Number(req.params.id));
    if (!todo) {
      res.status(404).json({ error: "Todo not found" });
      return;
    }
    res.status(200).json(todo);
  });

  sampleApi.get("/todos", (req, res) => {
    res.status(200).json(todos);
  });

  sampleApi.post("/todos", (req, res) => {
    console.log("Request body:", req.body);
    let todo = new Todo(req.body.title, false, req.body.source);
    console.log("Created todo:", todo);
    todo.id = generateId();
    todos.push(todo);

    res.status(201).json(todo);
  });

  sampleApi.put("/todos/:id/done", (req, res) => {
    const todo = getTodo(Number(req.params.id));
    if (!todo) {
      res.status(404).json({ error: "Todo not found" });
      return;
    }
    res.status(200).json(todo.done());
  });

  sampleApi.listen(WEB_API_PORT, (error?: Error) => {
    if (error) {
      console.error("Failed to start sample Web API server:", error);
      process.exit(1);
    }

    console.log("Sample Web API Server running");
    console.log(`Sample Web API listening on http://localhost:${WEB_API_PORT}`);
    console.log(`Sample endpoint: http://localhost:${WEB_API_PORT}/todos`);
    console.log(`Sample endpoint: http://localhost:${WEB_API_PORT}/todos/1`);
    console.log(`Sample endpoint: http://localhost:${WEB_API_PORT}/todos/1/done`);
  });
}

try {
  boot();
} catch (error) {
  console.error("Fatal error:", error);
  process.exit(1);
}
