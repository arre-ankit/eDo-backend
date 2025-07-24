# eDo Backend - Cloudflare Workers + Durable Objects

This is the backend for the eDo Todo application, built with Cloudflare Workers, Durable Objects, and Langbase integration for AI-powered task processing.

## Features

- **Durable Objects**: Persistent task processing with state management
- **AI Integration**: Uses Langbase and OpenAI GPT-4o-mini for intelligent task breakdown
- **Real-time Status**: Track task progress and subtask completion
- **CORS Support**: Configured for Next.js frontend integration

## Prerequisites

1. **Cloudflare Account**: Sign up at [cloudflare.com](https://cloudflare.com)
2. **Wrangler CLI**: Install globally with `npm install -g wrangler`
3. **API Keys**: 
   - Langbase API key from [langbase.com](https://langbase.com)
   - OpenAI API key from [openai.com](https://openai.com)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Login to Cloudflare

```bash
wrangler login
```

### 3. Set Environment Variables

Set your secrets using Wrangler:

```bash
# Set your Langbase API key
wrangler secret put LANGBASE_API_KEY

# Set your OpenAI API key  
wrangler secret put LLM_API_KEY

# Set a JWT secret for authentication (generate a random string)
wrangler secret put JWT_SECRET
```

### 4. Configure Durable Objects (Optional)

If you need to create the Durable Objects namespace manually:

```bash
# This is typically handled automatically by wrangler.jsonc
wrangler durable-objects:namespace create TASK_PROCESSOR
```

### 5. Development

Start the development server:

```bash
npm run dev
```

The worker will be available at `http://localhost:8787`

### 6. Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

## API Endpoints

### Health Check
- **GET** `/health` - Returns service health status

### Task Management
- **POST** `/api/tasks` - Create a new task
  ```json
  {
    "prompt": "Research market trends for Q1 2024"
  }
  ```

- **GET** `/api/tasks/:id` - Get task status and progress
- **GET** `/api/tasks` - List tasks (placeholder)

## Architecture

### Durable Objects

The `TaskProcessorDO` class handles:
- Task initialization and state management
- AI-powered subtask generation using Langbase
- Progressive task completion tracking
- Error handling and status reporting

### Workflow

1. **Task Creation**: Client sends a prompt via POST `/api/tasks`
2. **Durable Object**: Creates a new TaskProcessorDO instance
3. **AI Processing**: Langbase generates subtasks from the prompt
4. **Execution**: Each subtask is processed sequentially
5. **Status Updates**: Real-time progress tracking via GET `/api/tasks/:id`

## Environment Variables

### Required Secrets
- `LANGBASE_API_KEY` - Your Langbase API key
- `LLM_API_KEY` - Your OpenAI API key
- `JWT_SECRET` - Secret key for JWT tokens

### Optional Variables
- `ENVIRONMENT` - Set to "development" or "production"

## Configuration Files

- `wrangler.jsonc` - Cloudflare Workers configuration
- `package.json` - Dependencies and scripts
- `src/index.ts` - Main worker code with Durable Objects

## CORS Configuration

The worker is configured to accept requests from:
- `http://localhost:3000` (Next.js development)
- `https://localhost:3000` (Next.js development with HTTPS)

Update the CORS origins in `src/index.ts` for production domains.

## Troubleshooting

### Common Issues

1. **Durable Objects not working**: Ensure you're on a paid Cloudflare plan
2. **API key errors**: Verify your secrets are set correctly with `wrangler secret list`
3. **CORS errors**: Check that your frontend URL is included in the CORS configuration

### Debugging

View logs during development:
```bash
wrangler tail
```

For production logs:
```bash
wrangler tail --env production
```

## Production Deployment

1. Update CORS origins in `src/index.ts` with your production frontend URL
2. Set production environment variables:
   ```bash
   wrangler secret put LANGBASE_API_KEY --env production
   wrangler secret put LLM_API_KEY --env production
   wrangler secret put JWT_SECRET --env production
   ```
3. Deploy:
   ```bash
   npm run deploy
   ```

## License

MIT License - see LICENSE file for details.
