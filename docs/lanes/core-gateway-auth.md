# core-gateway-auth

Round 4 core lane. It owns `gateway.ts`, `actions.ts` (the second ask), `vault.ts` (secrets and PIN), `plugins.ts` (the canary) and the keychain and secret store. Its RPC methods live in `platform/runtime/modules/lane-core-gateway-auth.ts`, which spreads three method files under `platform/runtime/gateway-auth/`:

- `gateway-methods.ts`: route order, route states, discarding a waiting send, the monthly cap.
- `approval-methods.ts`: the second ask and per-member approval secrets.
- `vault-methods.ts`: the secret store status, PIN quick unlock and `network.online`.

<!-- SECTIONS -->
