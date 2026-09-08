# chatgpt-shot

Local TypeScript CLI for one-shot ChatGPT work delivered through a Notion invocation page.

From this directory, install dependencies and build:

```sh
npm install
npm run build
```

The CLI always finds the repository-root `.env`; it requires `NOTION_TOKEN`. Set up the mailbox
and browser session with:

```sh
node dist/cli.js init --notion-page 'https://www.notion.so/...'
node dist/cli.js login
node dist/cli.js doctor
node dist/cli.js submit 'your task'
```

`login` intentionally waits for manual ChatGPT authentication. `submit` never automates login and
returns `CHATGPT_AUTH_REQUIRED` before creating an invocation when the session is absent. Results
come only from the completed Notion page body, never the ChatGPT assistant UI.
