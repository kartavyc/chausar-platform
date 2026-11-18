# Venture test fixtures

Every file in this folder is a synthetic recording: written by hand for the venture launcher tests and the offline demo, never captured from a live account, a real model provider or a real GitHub repository. Each fixture says `"label": "synthetic recording"`, and any screen that shows data from one says so. No file here holds a real key, token, person, client or business.

`compose-unit/` holds the shared steps for tests that run the real engine (a business made the way the first run makes one), and a composed plan written straight into a vault, for the code that still reads one; nothing composes a plan any more. The demo replay in `demo/model-replay.json` answers the plan, the brief and the bookkeeping rehearsal with its agent turns.
