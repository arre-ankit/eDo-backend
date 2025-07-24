import { Hono } from "hono";
import { cors } from "hono/cors";
import { Langbase } from "langbase";

interface Env {
  DB: D1Database;
  TASK_PROCESSOR: DurableObjectNamespace;
  LANGBASE_API_KEY: string;
  LLM_API_KEY: string;
  JWT_SECRET: string;
}

// In-memory storage for task IDs (use D1 database in production)
const TASK_STORAGE = new Map<string, {
  taskId: string;
  prompt: string;
  createdAt: number;
  status: string;
}>();

export class TaskProcessorDO {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === "/process" && request.method === "POST") {
      const body = await request.json() as { prompt: string };
      await this.initialize(body.prompt);
      this.process(body.prompt); // Don't await - let it run in background
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    if (url.pathname === "/status" && request.method === "GET") {
      const status = await this.getStatus();
      return new Response(JSON.stringify(status), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    return new Response("Not Found", { status: 404 });
  }

  async initialize(prompt: string) {
    await this.state.storage.put("prompt", prompt);
    await this.state.storage.put("status", "pending");
    await this.state.storage.put("created_at", Date.now());
  }

  async process(prompt: string) {
    await this.state.storage.put("status", "processing");
    
          const langbase = new Langbase({
            apiKey: this.env.LANGBASE_API_KEY,
          });

      try {
        // First, get subtasks from LLM using Langbase
        const subtaskGeneration = await langbase.agent.run({
          model: 'openai:gpt-4.1-mini',
          apiKey: this.env.LLM_API_KEY,
          input: [
            {
              role: 'user',
              content: `Based on the following task, generate a list of 3-5 specific, actionable subtasks. Return ONLY a JSON array of strings, no other text or formatting.\n\nTask: ${prompt}`
            },
          ],
          stream: false
        });

        console.log('Subtask generation response:', subtaskGeneration)

      let subtasks;
      try {
        const subtaskList = JSON.parse(subtaskGeneration.output);
        subtasks = subtaskList.map((description: string, index: number) => ({
          id: `${index + 1}`,
          description,
          status: "pending",
          result: null,
          completedAt: null
        }));
      } catch (parseError) {
        // Fallback if JSON parsing fails
        subtasks = [ 'Error in processing subtask'
         
        ];
      }

      await this.state.storage.put("subtasks", subtasks);

      // Process each subtask
      for (const subtask of subtasks) {
        subtask.status = "processing";
        await this.state.storage.put("subtasks", subtasks);

        const taskCompletion = await langbase.agent.run({
          model: "openai:gpt-4o-mini",
          apiKey: this.env.LLM_API_KEY,
          input: [
            {
              role: 'user',
              content: `Complete this specific subtask thoroughly and provide detailed results:\n\nSubtask: ${subtask.description}`
            },
          ],
          stream: false
        });

        subtask.status = "completed";
        subtask.result = taskCompletion.output;
        subtask.completedAt = Date.now();
        await this.state.storage.put("subtasks", subtasks);
      }

      await this.state.storage.put("status", "completed");
      await this.state.storage.put("completed_at", Date.now());
    } catch (error) {
      await this.state.storage.put("status", "failed");
      await this.state.storage.put("error", error instanceof Error ? error.message : String(error));
      console.error("Task processing error:", error);
    }
  }

  async getStatus() {
    const status = await this.state.storage.get("status");
    const subtasks = await this.state.storage.get("subtasks");
    const error = await this.state.storage.get("error");
    const prompt = await this.state.storage.get("prompt");
    const createdAt = await this.state.storage.get("created_at");
    const completedAt = await this.state.storage.get("completed_at");
    
    return { 
      status, 
      subtasks, 
      error, 
      prompt,
      createdAt,
      completedAt
    };
  }
}

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for all routes
app.use("/*", cors({
  origin: ["http://localhost:3000", "https://localhost:3000"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

// Health check endpoint
app.get("/health", (c) => {
  return c.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Create a new task
app.post("/api/tasks", async (c) => {
  try {
    const { prompt } = await c.req.json();
    
    if (!prompt || typeof prompt !== "string") {
      return c.json({ error: "Prompt is required and must be a string" }, 400);
    }

    // Create a unique task ID
    const taskId = crypto.randomUUID();
    
    // Store task metadata
    TASK_STORAGE.set(taskId, {
      taskId,
      prompt,
      createdAt: Date.now(),
      status: "pending"
    });
    
    // Get the Durable Object instance
    const id = c.env.TASK_PROCESSOR.idFromName(taskId);
    const taskProcessor = c.env.TASK_PROCESSOR.get(id);
    
    // Initialize the task
    const response = await taskProcessor.fetch(new Request(`https://task-processor/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    }));

    if (!response.ok) {
      throw new Error(`Failed to initialize task: ${response.status}`);
    }

    return c.json({ 
      success: true, 
      taskId,
      message: "Task created and processing started"
    });
  } catch (error) {
    console.error("Error creating task:", error);
    return c.json({ 
      error: "Failed to create task", 
      details: error instanceof Error ? error.message : String(error) 
    }, 500);
  }
});

// Get task status
app.get("/api/tasks/:id", async (c) => {
  try {
    const taskId = c.req.param("id");
    
    // Check if task exists
    const taskMeta = TASK_STORAGE.get(taskId);
    if (!taskMeta) {
      return c.json({ error: "Task not found" }, 404);
    }
    
    // Get the Durable Object instance
    const id = c.env.TASK_PROCESSOR.idFromName(taskId);
    const taskProcessor = c.env.TASK_PROCESSOR.get(id);
    
    // Get task status
    const response = await taskProcessor.fetch(new Request(`https://task-processor/status`, {
      method: "GET"
    }));

    if (!response.ok) {
      throw new Error(`Failed to get task status: ${response.status}`);
    }

    const status = await response.json() as Record<string, any>;
    
    return c.json({ 
      taskId,
      ...status
    });
  } catch (error) {
    console.error("Error getting task status:", error);
    return c.json({ 
      error: "Failed to get task status", 
      details: error instanceof Error ? error.message : String(error) 
    }, 500);
  }
});

// List all tasks
app.get("/api/tasks", async (c) => {
  try {
    const allTasks: any[] = [];
    
    // Get all tasks from storage
    for (const [taskId, taskMeta] of TASK_STORAGE.entries()) {
      try {
        // Get detailed status from Durable Object
        const id = c.env.TASK_PROCESSOR.idFromName(taskId);
        const taskProcessor = c.env.TASK_PROCESSOR.get(id);
        
        const response = await taskProcessor.fetch(new Request(`https://task-processor/status`, {
          method: "GET"
        }));
        
        if (response.ok) {
          const status = await response.json() as Record<string, any>;
          allTasks.push({
            ...taskMeta,
            ...status
          });
        } else {
          // If DO doesn't respond, use basic metadata
          allTasks.push(taskMeta);
        }
      } catch (error) {
        // If error getting detailed status, use basic metadata
        allTasks.push(taskMeta);
      }
    }
    
    // Sort by creation date (newest first)
    allTasks.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    
    return c.json({ 
      success: true,
      tasks: allTasks,
      total: allTasks.length,
      message: "Task listing implemented with in-memory storage"
    });
  } catch (error) {
    console.error("Error listing tasks:", error);
    return c.json({ 
      error: "Failed to list tasks", 
      details: error instanceof Error ? error.message : String(error) 
    }, 500);
  }
});

// Fallback route
app.all("*", (c) => {
  return c.json({ error: "Route not found" }, 404);
});

export default app;
