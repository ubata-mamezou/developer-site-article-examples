import express, { type Request, type Response } from "express";
import { todo } from "node:test";

const WEB_API_PORT = Number(process.env.WEB_API_PORT ?? "3001");


class Todo {
  id?: number;
  no?: string;

  constructor(private title: string, private source: string, private completed: boolean = false) { }

  generateId = () => Math.floor(Math.random() * 1000);

  save(): Todo {
    this.id = this.generateId();
    this.no = `T-${this.id}`;
    return this;
  }

  done(): Todo {
    this.completed = true;
    return this;
  }
}

type CreateTodoRequest = Omit<Todo, "id" | "no">;
type SearchTodoRequest = Pick<Todo, "no">;

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
  const convertId = (id: string | number): number => Number(id);
  const getTodo = (id: number) => {
    return todos.find((t) => t.id === id);
  };

  // 1件取得
  sampleApi.get("/todos/:id", (req: Request<{ id: number }>, res: Response) => {
    const todo = getTodo(convertId(req.params.id));
    if (!todo) {
      res.status(404).json({ error: "Todo not found" });
      return;
    }
    res.status(200).json(todo);
  });

  // リスト取得
  sampleApi.get("/todos", (req: Request, res: Response) => {
    res.status(200).json(todos);
  });

  // noで検索
  sampleApi.post("/todos/search", (req: Request<SearchTodoRequest>, res: Response) => {
    const filteredTodos = todos.filter((t) => t.no === req.body.no);
    res.status(200).json(filteredTodos);
  });

  // 登録
  sampleApi.post("/todos", (req: Request<CreateTodoRequest>, res: Response) => {
    const body = req.body;
    let todo = new Todo(body.title, body.source).save();
    todos.push(todo);

    res.status(201).json(todo);
  });

  // 完了
  sampleApi.put("/todos/:id/done", (req: Request<{ id: number }>, res: Response) => {
    const todo = getTodo(convertId(req.params.id));
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
