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
node dist/cli.js init --notion-database 'https://www.notion.so/...'
node dist/cli.js login
node dist/cli.js doctor
node dist/cli.js submit 'your task'
```

Create an empty Invocation database, share it with the configured Notion integration, then pass
its direct link to `init`; the command configures and verifies the required schema. It never
creates a database or modifies an already configured database. `login` launches normal system
Chrome with the dedicated profile and waits for the user to close it after manual ChatGPT
authentication; credential entry is never automation-controlled. `submit` never automates login and
returns `CHATGPT_AUTH_REQUIRED` before creating an invocation when the session is absent. Results
come only from the completed Notion page body, never the ChatGPT assistant UI.

In this runtime, first sign in to the same dedicated Chrome browser profile, then sign in to
ChatGPT in that profile. This is an observed session-persistence prerequisite, not a claim that a
Chrome or Google browser-profile sign-in authenticates ChatGPT itself.
