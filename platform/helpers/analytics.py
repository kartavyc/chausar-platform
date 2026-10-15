"""Trusted, bounded JSON analytical helper. No user programs, paths or shell commands."""
import base64
import io
import json
import re
import sys
from fractions import Fraction

INPUT_LIMIT = 6 * 1024 * 1024
OUTPUT_LIMIT = 1024 * 1024


class Refused(Exception):
    def __init__(self, code):
        self.code = code


def require(condition, code="INVALID_HELPER_INPUT"):
    if not condition:
        raise Refused(code)


def exact_money(value, nonnegative=False):
    require(isinstance(value, str) and re.fullmatch(r"-?(?:0|[1-9][0-9]{0,37})", value))
    result = int(value)
    require(not nonnegative or result >= 0)
    return result


def keys(value, allowed, required=()):
    require(isinstance(value, dict) and set(value).issubset(allowed) and set(required).issubset(value))


def forecast_value(series):
    size = len(series)
    sx = size * (size - 1) // 2
    sxx = size * (size - 1) * (2 * size - 1) // 6
    sy = sum(series)
    sxy = sum(index * value for index, value in enumerate(series))
    denominator = size * sxx - sx * sx
    if denominator == 0:
        return series[-1]
    slope = Fraction(size * sxy - sx * sy, denominator)
    prediction = Fraction(sy, size) + slope * Fraction(size + 1, 2)
    return int(prediction)  # Fraction -> int truncates toward zero, never float.


def forecast(data):
    keys(data, {"months", "currency"}, {"months", "currency"})
    require(re.fullmatch(r"[A-Z]{3}", data["currency"]) is not None)
    months = data["months"]
    require(isinstance(months, list) and 8 <= len(months) <= 120, "FORECAST_HISTORY_REQUIRED")
    series = []
    previous = None
    for month in months:
        keys(month, {"month", "amountMinor"}, {"month", "amountMinor"})
        require(isinstance(month["month"], str) and re.fullmatch(r"[0-9]{4}-(?:0[1-9]|1[0-2])", month["month"]))
        year, number = map(int, month["month"].split("-"))
        require(1 <= year <= 9999)
        ordinal = year * 12 + number - 1
        require(previous is None or ordinal == previous + 1, "FORECAST_GAP")
        previous = ordinal
        series.append(exact_money(month["amountMinor"]))
    holdout = 3
    baseline_error = 0
    candidate_error = 0
    folds = []
    for index in range(len(series) - holdout, len(series)):
        baseline = series[index - 1]
        candidate = forecast_value(series[:index])
        actual = series[index]
        baseline_abs = abs(actual - baseline)
        candidate_abs = abs(actual - candidate)
        baseline_error += baseline_abs
        candidate_error += candidate_abs
        folds.append({"month": months[index]["month"], "actualMinor": str(actual), "baselineMinor": str(baseline), "candidateMinor": str(candidate), "baselineErrorMinor": str(baseline_abs), "candidateErrorMinor": str(candidate_abs)})
    passes = candidate_error < baseline_error
    return {"status": "passed-local-baseline-gate" if passes else "refused", "forecastMinor": str(forecast_value(series)) if passes else None, "baselineMinor": str(series[-1]), "baselineErrorMinor": str(baseline_error), "candidateErrorMinor": str(candidate_error), "holdoutMonths": holdout, "folds": folds, "currency": data["currency"], "qualification": "experimental", "method": "Expanding-window linear trend using rational arithmetic; last-observed-month baseline; three withheld final months", "rounding": "Truncate fractional minor units toward zero", "uncertainty": "A local backtest does not certify future accuracy or independently qualify a forecasting model."}


def optimize(data):
    keys(data, {"budgetMinor", "currency", "items"}, {"budgetMinor", "currency", "items"})
    budget = exact_money(data["budgetMinor"], True)
    require(isinstance(data["currency"], str) and re.fullmatch(r"[A-Z]{3}", data["currency"]))
    require(isinstance(data["items"], list) and 0 < len(data["items"]) <= 50)
    items = []
    seen = set()
    total_units = 0
    for item in data["items"]:
        keys(item, {"id", "costMinor", "valueMinor", "maxUnits"}, {"id", "costMinor", "valueMinor"})
        require(isinstance(item["id"], str) and 0 < len(item["id"]) <= 100 and item["id"] not in seen)
        seen.add(item["id"])
        units = item.get("maxUnits", 1)
        require(type(units) is int and 1 <= units <= 100)
        total_units += units
        require(total_units <= 200, "OPTIMIZATION_LIMIT")
        items.append({"id": item["id"], "cost": exact_money(item["costMinor"], True), "value": exact_money(item["valueMinor"]), "units": units})
    items.sort(key=lambda item: item["id"])
    # Exact bounded integer knapsack. Dominated lower-benefit/higher-cost states
    # can never improve a solution with the same remaining item suffix.
    frontier = {0: (0, tuple(0 for _ in items))}
    for index, item in enumerate(items):
        for _ in range(item["units"]):
            candidates = dict(frontier)
            for spent, (benefit, allocation) in frontier.items():
                cost = spent + item["cost"]
                if cost > budget:
                    continue
                value = benefit + item["value"]
                existing = candidates.get(cost)
                if existing is None or value > existing[0]:
                    counts = list(allocation)
                    counts[index] += 1
                    candidates[cost] = (value, tuple(counts))
            frontier = {}
            best = None
            for cost in sorted(candidates):
                state = candidates[cost]
                if best is None or state[0] > best:
                    frontier[cost] = state
                    best = state[0]
            require(len(frontier) <= 10000, "OPTIMIZATION_LIMIT")
    spent, (benefit, allocation) = max(frontier.items(), key=lambda pair: (pair[1][0], -pair[0]))
    selected = [{"id": item["id"], "units": count, "costMinor": str(item["cost"] * count), "valueMinor": str(item["value"] * count)} for item, count in zip(items, allocation) if count]
    return {"allocation": selected, "spendMinor": str(spent), "benefitMinor": str(benefit), "unspentMinor": str(budget - spent), "currency": data["currency"], "optimal": True, "qualification": "experimental", "algorithm": "Bounded integer knapsack with exact Pareto frontier", "assumptions": ["Item costs and benefits are supplied assumptions, not verified business facts.", "No money is spent and no external action is approved."]}


def pdf_password(data):
    """An optional PDF password: used to open the file, never echoed, logged or returned."""
    password = data.get("password")
    require(password is None or (isinstance(password, str) and 1 <= len(password) <= 256))
    return password


def password_refusal(error, password):
    """Encrypted with no password supplied, or the supplied password is wrong: two distinct codes."""
    seen, current = 0, error
    while current is not None and seen < 5:
        name = type(current).__name__
        if name in ("PDFPasswordIncorrect", "PDFEncryptionError") or "password" in str(getattr(current, "args", [""])[:1]).lower():
            return Refused("WRONG_PASSWORD" if password else "PASSWORD_REQUIRED")
        current, seen = current.__cause__ or current.__context__, seen + 1
    return None


def pdf_extract(data):
    keys(data, {"pdfBase64", "maxPages", "password"}, {"pdfBase64"})
    password = pdf_password(data)
    require(isinstance(data["pdfBase64"], str) and len(data["pdfBase64"]) <= 5600000)
    maximum = data.get("maxPages", 20)
    require(type(maximum) is int and 1 <= maximum <= 50)
    try:
        raw = base64.b64decode(data["pdfBase64"], validate=True)
    except Exception:
        raise Refused("INVALID_PDF")
    require(len(raw) <= 4 * 1024 * 1024 and raw.startswith(b"%PDF-"), "INVALID_PDF")
    try:
        import pdfplumber
    except ImportError:
        raise Refused("PDF_DEPENDENCY_UNAVAILABLE")
    pages = []
    characters = 0
    try:
        with pdfplumber.open(io.BytesIO(raw), password=password or "") as document:
            require(len(document.pages) <= maximum, "PDF_PAGE_LIMIT")
            for index, page in enumerate(document.pages):
                text = page.extract_text() or ""
                characters += len(text)
                require(characters <= 100000, "PDF_TEXT_LIMIT")
                pages.append({"page": index + 1, "text": text})
    except Refused:
        raise
    except Exception as error:
        raise password_refusal(error, password) or Refused("PDF_EXTRACT_FAILED")
    return {"pages": pages, "pageCount": len(pages), "characters": characters, "sourceTainted": True, "numericalStatus": "unverified", "requiresReview": True, "parserVersion": getattr(pdfplumber, "__version__", "unknown"), "coverage": "Text extraction only. Scanned image pages need a separately qualified OCR adapter."}


def pdf_status(data):
    """Which PDF readers this helper can use. Reads nothing and opens no file."""
    keys(data, set(), set())
    found = {}
    for name in ("pdfplumber", "pypdfium2", "PIL"):
        try:
            __import__(name)
            found[name] = True
        except ImportError:
            found[name] = False
    try:
        ocr_tesseract()
        tesseract = True
    except Exception:
        tesseract = False
    return {"pdfText": found["pdfplumber"], "pdfOcr": found["pypdfium2"] and found["PIL"] and tesseract, "tesseract": tesseract}


OCR_DPI = 300
OCR_MAX_SIDE = 5000
OCR_LANGUAGES = {"eng"}
OCR_DEADLINE_SECONDS = 25


def bundled_tesseract():
    """
    The release's bundled tesseract, beside this interpreter: <runtime>/python/bin/python3 (python/python.exe
    on Windows) -> <runtime>/tesseract/bin/tesseract[.exe] and <runtime>/tesseract/share/tessdata. Only a
    regular file (never a symbolic link) whose real path stays inside the runtime folder is accepted.
    Returns (program, tessdata folder) or None.
    """
    import os
    import stat
    python = os.path.dirname(os.path.realpath(sys.executable))
    python_root = python if os.name == "nt" else os.path.dirname(python)
    if os.path.basename(python_root).lower() != "python":
        return None
    runtime = os.path.dirname(python_root)
    program = os.path.join(runtime, "tesseract", "bin", "tesseract.exe" if os.name == "nt" else "tesseract")
    tessdata = os.path.join(runtime, "tesseract", "share", "tessdata")
    try:
        info = os.lstat(program)
        real = os.path.realpath(program)
        if not stat.S_ISREG(info.st_mode) or os.path.commonpath([real, runtime]) != runtime or not os.path.isdir(tessdata):
            return None
    except (OSError, ValueError):
        return None
    return real, tessdata


def ocr_tesseract():
    """
    The bundled tesseract (see bundled_tesseract), else the installed program found only on the default
    system path (the helper is given no PATH).
    pytesseract is deliberately not imported: it passes images through temporary files, which this helper
    may not write (RLIMIT_FSIZE 0), and it imports pandas when present, which cannot map inside the
    256 MB address-space limit. tesseract is driven directly over pipes instead.
    """
    import os
    import shutil
    bundled = bundled_tesseract()
    if bundled is not None:
        return bundled[0]
    found = shutil.which("tesseract", path=os.defpath)
    require(found is not None, "OCR_DEPENDENCY_UNAVAILABLE")
    return found


def tesseract_environment(tesseract):
    """The fixed environment tesseract runs with; the bundled program reads its own language data."""
    import os
    environment = {"OMP_THREAD_LIMIT": "1"}
    if os.name == "nt":
        environment["SystemRoot"] = os.environ.get("SystemRoot", "C:\\Windows")
    bundled = bundled_tesseract()
    if bundled is not None and bundled[0] == tesseract:
        environment["TESSDATA_PREFIX"] = bundled[1]
    return environment


def ocr_page(tesseract, png, language, deadline):
    """One page image through tesseract over pipes (the helper may not write files). Returns lines and word confidences."""
    import os
    import subprocess
    import time
    remaining = deadline - time.monotonic()
    require(remaining > 0, "PDF_EXTRACT_FAILED")
    environment = tesseract_environment(tesseract)
    try:
        completed = subprocess.run([tesseract, "stdin", "stdout", "-l", language, "--psm", "6", "tsv"], input=png, capture_output=True, timeout=remaining, env=environment, shell=False)
    except Exception:
        raise Refused("PDF_EXTRACT_FAILED")
    require(completed.returncode == 0, "PDF_EXTRACT_FAILED")
    lines = {}
    confidences = []
    for row in completed.stdout.decode("utf-8", "replace").splitlines()[1:]:
        cells = row.split("\t")
        if len(cells) != 12 or cells[0] != "5" or not cells[11].strip():
            continue
        try:
            confidence = float(cells[10])
            key = (int(cells[2]), int(cells[3]), int(cells[4]))
        except ValueError:
            continue
        if confidence < 0:
            continue
        lines.setdefault(key, []).append(cells[11].strip())
        confidences.append(min(100.0, confidence))
    text = "\n".join(" ".join(words) for _, words in sorted(lines.items()))
    # Whole-number percent (the helper protocol carries integers only); a page with no words has none.
    confidence = int(sum(confidences) / len(confidences)) if confidences else 0
    return text, confidence


def pdf_ocr(data):
    """EXPERIMENTAL: scanned PDF pages rendered in memory and read by tesseract. Same limits as pdf.extract."""
    import time
    deadline = time.monotonic() + OCR_DEADLINE_SECONDS
    keys(data, {"pdfBase64", "maxPages", "language", "password"}, {"pdfBase64"})
    password = pdf_password(data)
    require(isinstance(data["pdfBase64"], str) and len(data["pdfBase64"]) <= 5600000)
    maximum = data.get("maxPages", 20)
    require(type(maximum) is int and 1 <= maximum <= 50)
    language = data.get("language", "eng")
    require(isinstance(language, str) and language in OCR_LANGUAGES)
    try:
        raw = base64.b64decode(data["pdfBase64"], validate=True)
    except Exception:
        raise Refused("INVALID_PDF")
    require(len(raw) <= 4 * 1024 * 1024 and raw.startswith(b"%PDF-"), "INVALID_PDF")
    try:
        import pypdfium2
        from PIL import Image  # noqa: F401  (pypdfium2 renders to Pillow images)
    except ImportError:
        # pdf2image is not used: it hands the PDF to poppler through temporary files, which the helper may not write.
        raise Refused("OCR_DEPENDENCY_UNAVAILABLE")
    tesseract = ocr_tesseract()
    pages = []
    characters = 0
    try:
        document = pypdfium2.PdfDocument(raw, password=password)
    except Exception as error:
        raise password_refusal(error, password) or Refused("PDF_EXTRACT_FAILED")
    try:
        require(len(document) <= maximum, "PDF_PAGE_LIMIT")
        for index in range(len(document)):
            try:
                page = document[index]
                width, height = page.get_size()
                require(width > 0 and height > 0, "PDF_EXTRACT_FAILED")
                scale = min(OCR_DPI / 72.0, OCR_MAX_SIDE / max(width, height))
                image = page.render(scale=scale, grayscale=True).to_pil()
                buffer = io.BytesIO()
                image.save(buffer, format="PNG")
                png = buffer.getvalue()
                del image, buffer
            except Refused:
                raise
            except Exception:
                raise Refused("PDF_EXTRACT_FAILED")
            text, confidence = ocr_page(tesseract, png, language, deadline)
            characters += len(text)
            require(characters <= 100000, "PDF_TEXT_LIMIT")
            pages.append({"page": index + 1, "text": text, "confidence": confidence})
    finally:
        document.close()
    version = "unknown"
    try:
        import subprocess
        probe = subprocess.run([tesseract, "--version"], capture_output=True, timeout=5, env=tesseract_environment(tesseract), shell=False)
        first = (probe.stdout or probe.stderr).decode("utf-8", "replace").splitlines()
        if first and re.fullmatch(r"tesseract v?[0-9][0-9A-Za-z.\-]{0,40}", first[0].strip()):
            version = first[0].strip().split()[-1]
    except Exception:
        pass
    return {"pages": pages, "pageCount": len(pages), "characters": characters, "sourceTainted": True, "numericalStatus": "unverified", "requiresReview": True,
            "engine": "tesseract", "engineVersion": version, "renderer": "pypdfium2", "language": language, "confidenceScale": "mean word confidence, whole percent 0-100",
            "coverage": "EXPERIMENTAL OCR: page images read by tesseract. Characters, digits and amounts can be misread; every OCR page needs review and must pass the statement's own balance checks."}


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def process_limits():
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (8, 9))
        resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
        return True
    except (ImportError, OSError, ValueError):
        return False


def main():
    limits = process_limits()
    operation = None
    try:
        raw = sys.stdin.buffer.read(INPUT_LIMIT + 1)
        require(len(raw) <= INPUT_LIMIT, "HELPER_INPUT_LIMIT")
        request = json.loads(raw, object_pairs_hook=unique_pairs, parse_constant=lambda _: (_ for _ in ()).throw(Refused("INVALID_HELPER_INPUT")))
        keys(request, {"operation", "input"}, {"operation", "input"})
        operation = request["operation"]
        handlers = {"pdf.extract": pdf_extract, "pdf.ocr": pdf_ocr, "pdf.status": pdf_status, "forecast": forecast, "allocation.optimize": optimize}
        require(operation in handlers, "HELPER_OPERATION_UNSUPPORTED")
        result = handlers[operation](request["input"])
        output = {"ok": True, "operation": operation, "result": result, "runtime": {"python": sys.version.split()[0], "resourceLimits": limits}}
    except Refused as error:
        output = {"ok": False, "operation": operation, "error": {"code": error.code}}
    except Exception:
        output = {"ok": False, "operation": operation, "error": {"code": "HELPER_EXECUTION_FAILED"}}
    encoded = json.dumps(output, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(encoded) > OUTPUT_LIMIT:
        encoded = b'{"ok":false,"error":{"code":"HELPER_OUTPUT_LIMIT"}}'
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()
    if not output["ok"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
