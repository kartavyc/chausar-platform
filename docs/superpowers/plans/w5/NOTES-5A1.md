# 5A1 nits closed

The default validation day is now the India calendar day, so a current India rule does not fail before midnight UTC. A regression advances the clock into that interval. A second test loads every installed kit definition and checks validation/freeze, catching broken definitions when the test suite starts.

Independent batch-one re-review found both nits closed. Fresh define/wiring run: 31/31. The full shared-tree engine/UI typechecks and syntax/JSON checks passed before this commit; the batch and final visual gates remain outstanding. Changes to per-offer workflows and route selection are owned by later business packages and excluded from this commit.
