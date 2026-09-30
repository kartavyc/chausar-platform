import unittest
from dataclasses import replace
from business import (Unit, Field, ObjectType, Relationship, Expr, Metric, Model,
    ConsistencyGroup, AdapterCapabilities, VersionVector, Projection, ContractError,
    validate_model, validate_adapter, validate_publication)

INR = Unit((("currency:INR", 1),))
USD = Unit((("currency:USD", 1),))
def ref(name): return Expr("ref", name)
def binary(op, left, right): return Expr(op, args=(left, right))
def total(name): return Expr("sum", args=(ref(name),))

def example():
    invoice = ObjectType("Invoice", (Field("id", "string"), Field("gross", "number", INR),
        Field("cost", "number", INR), Field("customer", "string")), ("id",))
    customer = ObjectType("Customer", (Field("id", "string"),), ("id",))
    return Model("def1", (invoice, customer),
        (Relationship("customer", "Invoice", "Customer", ("customer",), ("id",), "many_to_one"),),
        (Metric("gross", total("Invoice.gross"), INR, ()),
         Metric("cost", total("Invoice.cost"), INR, ()),
         Metric("margin", binary("divide", binary("subtract", ref("gross"), ref("cost")), ref("gross")), Unit(), ())),
        (ConsistencyGroup("finance", ("Invoice.gross", "Invoice.cost")),))


class BusinessTests(unittest.TestCase):
    def test_valid_ratio_of_aggregate_measures(self):
        self.assertIn("expression:divide", validate_model(example()))

    def test_missing_reference_and_cycle(self):
        for expr in (ref("absent"), ref("margin")):
            model = example()
            with self.assertRaises(ContractError):
                validate_model(replace(model, metrics=model.metrics[:2] + (replace(model.metrics[2], expression=expr),)))

    def test_cross_currency_addition_rejected(self):
        model = example(); invoice = model.objects[0]
        invoice = replace(invoice, fields=invoice.fields + (Field("usd", "number", USD),))
        metric = Metric("bad", binary("add", ref("Invoice.gross"), ref("Invoice.usd")), INR, ("Invoice.id",))
        with self.assertRaisesRegex(ContractError, "incompatible units"):
            validate_model(replace(model, objects=(invoice, model.objects[1]), metrics=(metric,)))

    def test_explicit_fx_dimension_conversion(self):
        rate = INR.combine(USD, -1)
        invoice = ObjectType("Invoice", (Field("id", "string"), Field("usd", "number", USD), Field("fx", "number", rate)), ("id",))
        model = Model("d", (invoice,), metrics=(Metric("converted", binary("multiply", ref("Invoice.usd"), ref("Invoice.fx")), INR, ("Invoice.id",)),))
        validate_model(model)

    def test_no_scalar_broadcast_or_double_aggregation(self):
        for expr in (binary("add", ref("Invoice.gross"), ref("gross")), Expr("sum", args=(ref("gross"),))):
            model = example()
            with self.assertRaises(ContractError):
                validate_model(replace(model, metrics=model.metrics + (Metric("bad", expr, INR, ()),)))

    def test_bad_relationship_key(self):
        model = example()
        with self.assertRaises(ContractError):
            validate_model(replace(model, relationships=(replace(model.relationships[0], target_fields=("missing",)),)))

    def test_unsupported_expression_not_silently_dropped(self):
        model = example()
        with self.assertRaisesRegex(ContractError, "unsupported expression"):
            validate_model(replace(model, metrics=(Metric("x", Expr("forecast"), INR, ()),)))

    def test_lossy_adapter_rejected(self):
        model = example(); features = validate_model(model)
        validate_adapter(model, AdapterCapabilities("complete", features))
        with self.assertRaisesRegex(ContractError, "lossy adapter"):
            validate_adapter(model, AdapterCapabilities("lossy", features - {"consistency_groups"}))

    def cut(self):
        versions = VersionVector("def1", (("erp", "17"), ("costs", "9")), "identity4", "policy3")
        a = Projection("gross", replace(versions, data=(("erp", "17"),)), True, ("Invoice.gross",), (("finance", "cut7"),))
        b = Projection("cost", replace(versions, data=(("costs", "9"),)), True, ("Invoice.cost",), (("finance", "cut7"),))
        return versions, a, b

    def test_compatible_multisource_cut(self):
        versions, a, b = self.cut()
        self.assertTrue(validate_publication(example(), versions, (a, b), ("Invoice.gross",)))

    def test_data_can_advance_without_definition_change(self):
        versions, a, b = self.cut()
        newer = replace(versions, data=(("erp", "18"), ("costs", "9")))
        a = replace(a, versions=replace(a.versions, data=(("erp", "18"),)))
        validate_publication(example(), newer, (a, b), ("Invoice.gross",))
        self.assertEqual(newer.definition, versions.definition)

    def test_reject_identity_policy_definition_and_data_mismatches(self):
        versions, a, b = self.cut()
        for change in ({"identity": "wrong"}, {"policy": "wrong"}, {"definition": "wrong"}, {"data": (("erp", "16"),)}):
            with self.subTest(change=change), self.assertRaises(ContractError):
                validate_publication(example(), versions, (replace(a, versions=replace(a.versions, **change)), b), ("Invoice.gross",))

    def test_cross_field_token_mismatch_and_absent_member(self):
        versions, a, b = self.cut()
        for projections in ((a,), (a, replace(b, consistency_tokens=(("finance", "other"),))), (a, replace(b, consistency_tokens=()))):
            with self.assertRaises(ContractError):
                validate_publication(example(), versions, projections, ("Invoice.gross",))

    def test_unready_or_duplicate_provider(self):
        versions, a, b = self.cut()
        for projections in ((a, replace(b, ready=False)), (a, b, replace(a, id="duplicate"))):
            with self.assertRaises(ContractError):
                validate_publication(example(), versions, projections, ("Invoice.gross",))

    def test_duplicate_ids_and_noncanonical_units(self):
        with self.assertRaises(ContractError): Unit((("currency:INR", 0),))
        model = example()
        with self.assertRaises(ContractError): validate_model(replace(model, objects=model.objects + (model.objects[0],)))

    def test_consistency_group_closure_is_order_independent(self):
        model = example()
        model = replace(model, consistency_groups=(
            ConsistencyGroup("earlier", ("Invoice.cost", "Invoice.customer")),
            model.consistency_groups[0]))
        versions, a, b = self.cut()
        b = replace(b, consistency_tokens=b.consistency_tokens + (("earlier", "cut7"),))
        with self.assertRaisesRegex(ContractError, "missing required fields"):
            validate_publication(model, versions, (a, b), ("Invoice.gross",))


if __name__ == "__main__":
    unittest.main()
