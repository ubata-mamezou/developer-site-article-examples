import express from "express";

const WEB_API_PORT = Number(process.env.WEB_API_PORT ?? "3001");

function boot() {
  const sampleApi = express();

  sampleApi.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  sampleApi.get("/todos/:id", (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "id must be a number" });
      return;
    }

    res.json({
      id,
      title: `Sample Todo #${id}`,
      completed: id % 2 === 0,
      source: "local-sample-api",
    });
  });

  sampleApi.listen(WEB_API_PORT, (error?: Error) => {
    if (error) {
      console.error("Failed to start sample Web API server:", error);
      process.exit(1);
    }

    console.error("Sample Web API Server running");
    console.error(`Sample Web API listening on http://localhost:${WEB_API_PORT}`);
    console.error(`Sample endpoint: http://localhost:${WEB_API_PORT}/todos/1`);
  });
}

try {
  boot();
} catch (error) {
  console.error("Fatal error:", error);
  process.exit(1);
}
