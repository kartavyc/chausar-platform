# UCI ordinary download preflight

The user clarified that the earlier web-tool `4194305+` response-size error was a technical retrieval limit and authorized a new normal download attempt for the exact official licensed UCI ZIP. This did not authorize bypassing actual network/access restrictions, the separate Microsoft restricted URL or npm denial.

The [new receipt](uci-20260930-head-preflight.json) records a fresh ordinary PowerShell `Invoke-WebRequest -Method Head` preflight against `https://archive.ics.uci.edu/static/public/352/online%2Bretail.zip`. It failed under the current environment's network permissions before receiving HTTP headers:

> An attempt was made to access a socket in a way forbidden by its access permissions. (archive.ics.uci.edu:443)

The attempt stopped. No GET/download, elevation, retry, alternate downloader, mirror, security/network setting change or destination write followed. HTTP status, ZIP size, ETag, source checksum and local dataset path are unknown/null. This local socket restriction is separate from UCI's licence and from the older web size limit.

The official page was rechecked: Online Retail has a dataset-level CC BY 4.0 licence and a reported `Online Retail.xlsx` size of 22.6 MB. That workbook display size is not the ZIP's verified Content-Length. Existing attribution and normalized full licence text are retained unchanged in the previous commit.

Readonly storage observations: D: had 74,873,204,736 bytes free; `D:/Chausar/corpus` and the intended dataset directory were absent, giving zero corpus staging bytes. A conservative second check included all existing `D:/Chausar` project/build-tools bytes: 250,551,987 bytes. Under a decimal 4 GB shared limit, conservative headroom was 3,749,448,013 bytes. No space reservation or directory creation occurred.

Actual counts remain **0 acquired datasets, 0 acquired/retained dataset bytes, 0 coherent books and 0 acquired independent company/configuration origins**. One retailer is documented by the source; no business book or configuration bundle was acquired. No parser, projection, source-total reconciliation, holdout assignment or adapter qualification ran. CustomerID remains a pseudonymous identifier, and CustomerID/Country/Description exclusions are still only a plan.

The original semantic and stopped-intake snapshots remain unchanged. Resume only through an authorized transfer capability after the current socket restriction is resolved; record a new attempt rather than reinterpret this failed preflight as a dataset receipt. The separate Microsoft and npm restrictions remain in effect.
