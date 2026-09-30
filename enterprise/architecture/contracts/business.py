"""Executable semantic validation subset, not a service or query compiler."""
from dataclasses import dataclass


class ContractError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ContractError(message)


@dataclass(frozen=True)
class Unit:
    # Atomic dimensions include currency identity: currency:INR != currency:USD.
    powers: tuple[tuple[str, int], ...] = ()

    def __post_init__(self):
        require(all(isinstance(k, str) and k and type(v) is int and v != 0
                    for k, v in self.powers), "invalid unit dimension")
        require(tuple(sorted(self.powers)) == self.powers
                and len(dict(self.powers)) == len(self.powers), "noncanonical unit")

    def combine(self, other, sign=1):
        values = dict(self.powers)
        for key, power in other.powers:
            values[key] = values.get(key, 0) + sign * power
        return Unit(tuple(sorted((k, v) for k, v in values.items() if v)))


@dataclass(frozen=True)
class Field:
    id: str
    kind: str
    unit: Unit = Unit()


@dataclass(frozen=True)
class ObjectType:
    id: str
    fields: tuple[Field, ...]
    key: tuple[str, ...]


@dataclass(frozen=True)
class Relationship:
    id: str
    source: str
    target: str
    source_fields: tuple[str, ...]
    target_fields: tuple[str, ...]
    cardinality: str


@dataclass(frozen=True)
class Expr:
    op: str
    ref: str = ""
    args: tuple["Expr", ...] = ()


@dataclass(frozen=True)
class Metric:
    id: str
    expression: Expr
    unit: Unit
    grain: tuple[str, ...]


@dataclass(frozen=True)
class ConsistencyGroup:
    id: str
    fields: tuple[str, ...]


@dataclass(frozen=True)
class Model:
    definition_version: str
    objects: tuple[ObjectType, ...]
    relationships: tuple[Relationship, ...] = ()
    metrics: tuple[Metric, ...] = ()
    consistency_groups: tuple[ConsistencyGroup, ...] = ()


def index(items, label):
    require(all(isinstance(x.id, str) and x.id for x in items), f"empty {label} ID")
    result = {x.id: x for x in items}
    require(len(result) == len(items), f"duplicate {label} ID")
    return result


def validate_model(model):
    """Return required adapter features; reject unsupported operations explicitly.

    Grains are tuples of qualified key field IDs. No implicit joins/broadcasts.
    sum aggregates an entire keyed population to scalar. Grouping is unsupported.
    """
    require(bool(model.definition_version), "missing definition version")
    objects = index(model.objects, "object")
    relationships = index(model.relationships, "relationship")
    metrics = index(model.metrics, "metric")
    fields = {}
    features = {"typed_objects", "units", "explicit_grain"}
    for obj in objects.values():
        local = index(obj.fields, "field")
        require(obj.key and len(set(obj.key)) == len(obj.key)
                and set(obj.key) <= local.keys(), "invalid object key")
        for field in local.values():
            require(field.kind in {"number", "string", "boolean", "date"}, "unsupported field kind")
            require(field.kind == "number" or field.unit == Unit(), "unit on nonnumeric field")
            qualified = f"{obj.id}.{field.id}"
            require(qualified not in fields and qualified not in metrics, "ambiguous reference")
            fields[qualified] = (field, tuple(f"{obj.id}.{k}" for k in obj.key))
    for rel in relationships.values():
        require(rel.source in objects and rel.target in objects, "missing relationship endpoint")
        require(rel.cardinality in {"many_to_one", "one_to_many", "one_to_one"}, "unsupported cardinality")
        require(rel.source_fields and len(rel.source_fields) == len(rel.target_fields)
                and len(set(rel.source_fields)) == len(rel.source_fields)
                and len(set(rel.target_fields)) == len(rel.target_fields), "invalid join fields")
        for left, right in zip(rel.source_fields, rel.target_fields):
            lhs, rhs = fields.get(f"{rel.source}.{left}"), fields.get(f"{rel.target}.{right}")
            require(lhs is not None and rhs is not None, "missing join field")
            require((lhs[0].kind, lhs[0].unit) == (rhs[0].kind, rhs[0].unit), "incompatible join fields")
        if rel.cardinality in {"many_to_one", "one_to_one"}:
            require(rel.target_fields == objects[rel.target].key, "target is not declared unique key")
        if rel.cardinality in {"one_to_many", "one_to_one"}:
            require(rel.source_fields == objects[rel.source].key, "source is not declared unique key")
        features.add("relationships")
    groups = index(model.consistency_groups, "consistency group")
    for group in groups.values():
        require(len(group.fields) >= 2 and len(set(group.fields)) == len(group.fields)
                and set(group.fields) <= fields.keys(), "invalid consistency fields")
        features.add("consistency_groups")
    active, computed = set(), {}

    def infer(expr):
        features.add(f"expression:{expr.op}")
        if expr.op == "ref":
            require(expr.ref and not expr.args, "invalid reference expression")
            if expr.ref in fields:
                field, grain = fields[expr.ref]
                require(field.kind == "number", "nonnumeric expression")
                return field.unit, grain
            require(expr.ref in metrics, f"missing reference: {expr.ref}")
            return metric_type(expr.ref)
        require(not expr.ref, "unexpected expression reference")
        if expr.op == "sum":
            require(len(expr.args) == 1, "sum arity")
            unit, grain = infer(expr.args[0])
            require(bool(grain), "cannot sum an already scalar metric")
            return unit, ()
        require(expr.op in {"add", "subtract", "multiply", "divide"}, "unsupported expression")
        require(len(expr.args) == 2, "binary arity")
        lu, lg = infer(expr.args[0]); ru, rg = infer(expr.args[1])
        require(lg == rg, "grain mismatch; implicit joins/broadcasts unsupported")
        if expr.op in {"add", "subtract"}:
            require(lu == ru, "incompatible units")
            return lu, lg
        return lu.combine(ru, -1 if expr.op == "divide" else 1), lg

    def metric_type(name):
        if name in computed:
            return computed[name]
        require(name not in active, "metric dependency cycle")
        active.add(name)
        metric = metrics[name]
        actual = infer(metric.expression)
        require(actual == (metric.unit, metric.grain), f"declared metric type mismatch: {name}")
        active.remove(name)
        computed[name] = actual
        return actual

    for name in metrics:
        metric_type(name)
    return frozenset(features)


@dataclass(frozen=True)
class AdapterCapabilities:
    name: str
    features: frozenset[str]


def validate_adapter(model, adapter):
    missing = validate_model(model) - adapter.features
    require(not missing, f"lossy adapter {adapter.name}: {sorted(missing)}")


@dataclass(frozen=True)
class VersionVector:
    definition: str
    data: tuple[tuple[str, str], ...]
    identity: str
    policy: str

    def __post_init__(self):
        require(all(isinstance(v, str) and v for v in (self.definition, self.identity, self.policy)), "empty version")
        require(all(isinstance(k, str) and k and isinstance(v, str) and v for k, v in self.data)
                and len(dict(self.data)) == len(self.data), "invalid data vector")


@dataclass(frozen=True)
class Projection:
    id: str
    versions: VersionVector
    ready: bool
    fields: tuple[str, ...]
    # Tokens identify a producer-validated consistent cut, never mere timestamps.
    consistency_tokens: tuple[tuple[str, str], ...] = ()


def validate_publication(model, versions, projections, required_fields):
    validate_model(model)
    require(versions.definition == model.definition_version, "wrong model version")
    require(projections, "no projections")
    index(projections, "projection")
    known = {f"{o.id}.{f.id}" for o in model.objects for f in o.fields}
    groups = {g.id: g for g in model.consistency_groups}
    required = set(required_fields)
    require(required <= known, "unknown required field")
    while True:
        before = len(required)
        for group in groups.values():
            if required.intersection(group.fields):
                required.update(group.fields)
        if len(required) == before:
            break
    provided, tokens = set(), {}
    for projection in projections:
        require(projection.ready, "projection not ready")
        p = projection.versions
        require((p.definition, p.identity, p.policy) == (versions.definition, versions.identity, versions.policy), "incompatible publication versions")
        expected = dict(versions.data)
        require(p.data and all(expected.get(k) == v for k, v in p.data), "incompatible data revision")
        require(set(projection.fields) <= known, "unknown projection field")
        require(not provided.intersection(projection.fields), "ambiguous field provider")
        provided.update(projection.fields)
        local = dict(projection.consistency_tokens)
        require(len(local) == len(projection.consistency_tokens)
                and local.keys() <= groups.keys(), "invalid consistency tokens")
        for group in groups.values():
            if set(projection.fields).intersection(group.fields):
                token = local.get(group.id)
                require(isinstance(token, str) and bool(token), "missing consistency token")
                require(tokens.setdefault(group.id, token) == token, "incompatible consistency cut")
    require(required <= provided, "missing required fields")
    return True
