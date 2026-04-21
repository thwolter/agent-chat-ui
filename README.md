# Agent Chat UI

Agent Chat UI is a Next.js application which enables chatting with any LangGraph server with a `messages` key through a chat interface.

> [!NOTE]
> 🎥 Watch the video setup guide [here](https://youtu.be/lInrwVnZ83o).

## Setup

> [!TIP]
> Don't want to run the app locally? Use the deployed site here: [agentchat.vercel.app](https://agentchat.vercel.app)!

First, clone the repository, or run the [`npx` command](https://www.npmjs.com/package/create-agent-chat-app):

```bash
npx create-agent-chat-app
```

or

```bash
git clone https://github.com/langchain-ai/agent-chat-ui.git

cd agent-chat-ui
```

Install dependencies:

```bash
pnpm install
```

Run the app:

```bash
pnpm dev
```

The app will be available at `http://localhost:3000`.

## Usage

When the app starts, users must sign in before the chat UI is rendered.

The login form asks for:

- **Backend URL**: Base URL of your secure gateway (for example `http://localhost:8123`).
- **Email**
- **Password**
- **Assistant / Graph ID**

Authentication flow:

1. UI calls `POST /api/auth/login`.
2. Server route forwards to `<backend-url>/auth/login`.
3. Access token is stored in HTTP-only cookies, and the gateway refresh cookie is forwarded to the frontend proxy.
4. Chat traffic goes through `/api/[..._path]`, which injects the bearer token and proxies to `<backend-url>/gateway/*`.
5. The frontend refreshes access tokens through `POST /api/auth/refresh` before expiry and the proxy retries authenticated requests once after a 401.

The backend URL is remembered locally so it is prefilled on the next login.

## Gateway Contract

This fork expects auth endpoints documented by your backend and available in your deployment:

- `POST /auth/login` with `{ "email": "...", "password": "..." }`
- `POST /auth/refresh` with the refresh cookie, returning a rotated access token and refresh cookie
- `POST /auth/logout` with the refresh cookie, revoking the refresh session and clearing the cookie
- `GET /auth/session` with `Authorization: Bearer <token>`
- `GET /auth/me` with `Authorization: Bearer <token>`
- proxied LangGraph routes under `/gateway/{path}`

For local development with separate frontend and gateway origins, ensure the gateway allows the frontend origin through `CORS_ORIGINS`. HTTP local development should set `REFRESH_COOKIE_SECURE=false`; HTTPS environments should keep it enabled.

## Environment Variables

Copy `.env.example` to `.env`, then configure:

```bash
# Optional default assistant shown in login form.
NEXT_PUBLIC_ASSISTANT_ID=agent

# Optional public API proxy URL (default: /api)
NEXT_PUBLIC_API_PROXY_URL=/api

# Optional server-side fallback backend URL when no session cookie exists.
LANGGRAPH_API_URL=http://localhost:8123

# Optional server-side fallback token (service mode).
LANGGRAPH_BEARER_TOKEN=
```

## Hiding Messages in the Chat

You can control the visibility of messages within the Agent Chat UI in two main ways:

**1. Prevent Live Streaming:**

To stop messages from being displayed _as they stream_ from an LLM call, add the `langsmith:nostream` tag to the chat model's configuration. The UI normally uses `on_chat_model_stream` events to render streaming messages; this tag prevents those events from being emitted for the tagged model.

_Python Example:_

```python
from langchain_anthropic import ChatAnthropic

# Add tags via the .with_config method
model = ChatAnthropic().with_config(
    config={"tags": ["langsmith:nostream"]}
)
```

_TypeScript Example:_

```typescript
import { ChatAnthropic } from "@langchain/anthropic";

const model = new ChatAnthropic()
  // Add tags via the .withConfig method
  .withConfig({ tags: ["langsmith:nostream"] });
```

**Note:** Even if streaming is hidden this way, the message will still appear after the LLM call completes if it's saved to the graph's state without further modification.

**2. Hide Messages Permanently:**

To ensure a message is _never_ displayed in the chat UI (neither during streaming nor after being saved to state), prefix its `id` field with `do-not-render-` _before_ adding it to the graph's state, along with adding the `langsmith:do-not-render` tag to the chat model's configuration. The UI explicitly filters out any message whose `id` starts with this prefix.

_Python Example:_

```python
result = model.invoke([messages])
# Prefix the ID before saving to state
result.id = f"do-not-render-{result.id}"
return {"messages": [result]}
```

_TypeScript Example:_

```typescript
const result = await model.invoke([messages]);
// Prefix the ID before saving to state
result.id = `do-not-render-${result.id}`;
return { messages: [result] };
```

This approach guarantees the message remains completely hidden from the user interface.

## Rendering Artifacts

The Agent Chat UI supports rendering artifacts in the chat. Artifacts are rendered in a side panel to the right of the chat. To render an artifact, you can obtain the artifact context from the `thread.meta.artifact` field. Here's a sample utility hook for obtaining the artifact context:

```tsx
export function useArtifact<TContext = Record<string, unknown>>() {
  type Component = (props: {
    children: React.ReactNode;
    title?: React.ReactNode;
  }) => React.ReactNode;

  type Context = TContext | undefined;

  type Bag = {
    open: boolean;
    setOpen: (value: boolean | ((prev: boolean) => boolean)) => void;

    context: Context;
    setContext: (value: Context | ((prev: Context) => Context)) => void;
  };

  const thread = useStreamContext<
    { messages: Message[]; ui: UIMessage[] },
    { MetaType: { artifact: [Component, Bag] } }
  >();

  return thread.meta?.artifact;
}
```

After which you can render additional content using the `Artifact` component from the `useArtifact` hook:

```tsx
import { useArtifact } from "../utils/use-artifact";
import { LoaderIcon } from "lucide-react";

export function Writer(props: {
  title?: string;
  content?: string;
  description?: string;
}) {
  const [Artifact, { open, setOpen }] = useArtifact();

  return (
    <>
      <div
        onClick={() => setOpen(!open)}
        className="cursor-pointer rounded-lg border p-4"
      >
        <p className="font-medium">{props.title}</p>
        <p className="text-sm text-gray-500">{props.description}</p>
      </div>

      <Artifact title={props.title}>
        <p className="p-4 whitespace-pre-wrap">{props.content}</p>
      </Artifact>
    </>
  );
}
```

## Going to Production

Use HTTPS in production so secure cookies are always transmitted safely.

Recommended setup:

1. Serve this Next.js app behind your production domain.
2. Ensure users authenticate against your gateway via `/api/auth/login`.
3. Keep gateway token cookies HTTP-only.
4. Restrict allowed gateway origins at your infrastructure layer (reverse proxy / firewall / policy).
