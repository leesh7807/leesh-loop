# chatgpt-shot

Local TypeScript CLI for one-shot ChatGPT work delivered through a Notion invocation page.

From this directory, install dependencies and build:

```sh
npm install
npm run build
```

The CLI always finds the repository-root `.env`; it requires `NOTION_TOKEN` and
`NOTION_INVOCATION_DATABASE_URL`. Set up the mailbox
and browser session with:

```sh
node dist/cli.js init
node dist/cli.js login
node dist/cli.js doctor
node dist/cli.js submit 'your task'
```

Create an empty Invocation database, share it with the configured Notion integration, and put its
direct link in `NOTION_INVOCATION_DATABASE_URL`; `init` configures and verifies the required schema. It never
creates a database or modifies an already configured database. `login` launches normal system
Chrome with the dedicated profile and waits for the user to close it after manual ChatGPT
authentication; credential entry is never automation-controlled. `submit` never automates login and
returns `CHATGPT_AUTH_REQUIRED` before creating an invocation when the session is absent. Results
come only from the completed Notion page body, never the ChatGPT assistant UI.

To reuse a manually authenticated ChatGPT session across commands in this runtime, the dedicated
Chrome browser profile and ChatGPT must both be signed in. The observed working hypothesis is that
a guest browser profile does not reliably retain the ChatGPT session across separate launches.
This does not mean that a Chrome or Google browser-profile sign-in authenticates ChatGPT itself.
