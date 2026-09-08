# chatgpt-shot

Local TypeScript CLI for one-shot ChatGPT work delivered through a Notion invocation page.

From this directory, install dependencies and build:

```sh
npm install
npm run build
```

The CLI always finds the repository-root `.env`; it requires `NOTION_TOKEN` and
`CHATGPT_SHOT_NOTION_DATABASE_URL`. Set up the mailbox
and browser session with:

```sh
node dist/cli.js init
node dist/cli.js login
node dist/cli.js doctor
node dist/cli.js submit 'your task'
node dist/cli.js shutdown
```

Create an empty Invocation database, share it with the configured Notion integration, and put its
direct link in `CHATGPT_SHOT_NOTION_DATABASE_URL`; `init` configures and verifies the required schema. It never
creates a database or modifies an already configured database. `login` launches normal system
headed Chrome with the dedicated profile and waits for the user to close it after manual ChatGPT
authentication; credential entry is never automation-controlled. Afterwards, `submit` and `doctor`
use a background, headed system-Chrome runtime owned by a local owner-only broker. Its Chrome
control path is a private inherited pipe, not a TCP remote-debugging port; no browser window is
intentionally foregrounded during normal automation. `shutdown` explicitly closes that runtime.
`submit` never automates login and returns `CHATGPT_AUTH_REQUIRED` before creating an invocation
when the session is absent. Results
come only from the completed Notion page body, never the ChatGPT assistant UI.

To reuse a manually authenticated ChatGPT session, close the login browser before invoking a
normal command so the broker can exclusively own the same dedicated profile. ChatGPT login and
Chrome-profile sign-in are separate: neither substitutes for the other. Authentication preflight
uses visible ChatGPT login/account UI; a composer alone only establishes page readiness because it
can also be present for an anonymous visitor.
