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


def pdf_extract(data):
    keys(data, {"pdfBase64", "maxPages"}, {"pdfBase64"})
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
        with pdfplumber.open(io.BytesIO(raw)) as document:
            require(len(document.pages) <= maximum, "PDF_PAGE_LIMIT")
            for index, page in enumerate(document.pages):
                text = page.extract_text() or ""
                characters += len(text)
                require(characters <= 100000, "PDF_TEXT_LIMIT")
                pages.append({"page": index + 1, "text": text})
    except Refused:
        raise
    except Exception:
        raise Refused("PDF_EXTRACT_FAILED")
    return {"pages": pages, "pageCount": len(pages), "characters": characters, "sourceTainted": True, "numericalStatus": "unverified", "requiresReview": True, "parserVersion": getattr(pdfplumber, "__version__", "unknown"), "coverage": "Text extraction only. Scanned image pages need a separately qualified OCR adapter."}


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
        handlers = {"pdf.extract": pdf_extract, "forecast": forecast, "allocation.optimize": optimize}
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
