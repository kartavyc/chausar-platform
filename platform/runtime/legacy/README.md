# Older local engine requests

This dispatcher retains 163 older routes in the shared method registry. The trusted local server still forwards them, and their existing engine authorization and exact approval checks remain in force. Ink and hosted entrypoints do not admit these methods. The companion uses its separate typed phone host, not this RPC surface.

The historical list had 164 routes. The remaining trust.update route is still used by Connections to change the owner's disclosure policy, so it stays in the core dispatcher and renderer contract.

The engine loads this module only for an admitted legacy method after the open-vault and member checks. It supplies bound private capabilities through LegacyInternals without adding public class methods. Existing server, worker, phone, job and conversation acceptance tests remain the behavior checks, collected in the legacy test tier and always included by the full suite.

Removal of these endpoints is a separate founder decision.
