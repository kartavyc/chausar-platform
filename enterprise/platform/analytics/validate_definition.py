"""Trusted publication adapter for the supported invoice profile, using shared rules.
No source records, model calls or user-supplied code are executed.
"""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'architecture/contracts'))
from business import Unit,Field,ObjectType,Expr,Metric,Model,validate_model

profile={
 'gross_inr':{'fields':['amount','fx_to_inr'],'method':'sum_amount_times_fx','unit':'INR'},
 'shipment_quantity':{'fields':['shipment_quantity'],'method':'sum_shipments_at_invoice_grain','unit':'item'},
 'refund_inr':{'fields':['refund'],'method':'sum_inr_refunds_at_invoice_grain','unit':'INR'},
}
try:
 body=json.load(sys.stdin)
 if set(body)!={'dataset','measures'} or body['dataset']!='invoices' or body['measures']!=profile:
  raise ValueError('unsupported_definition_profile')
 currency=Unit((('currency:INR',1),)); native=Unit((('currency:source',1),)); item=Unit((('item',1),))
 rate=Unit((('currency:INR',1),('currency:source',-1)))
 objects=(ObjectType('Invoices',(Field('id','string'),Field('amount','number',native),Field('fx','number',rate)),('id',)),
          ObjectType('Shipments',(Field('id','string'),Field('quantity','number',item)),('id',)),
          ObjectType('Returns',(Field('id','string'),Field('refund','number',currency)),('id',)))
 ref=lambda value:Expr('ref',value)
 metrics=(Metric('gross_inr',Expr('sum',args=(Expr('multiply',args=(ref('Invoices.amount'),ref('Invoices.fx'))),)),currency,()),
          Metric('shipment_quantity',Expr('sum',args=(ref('Shipments.quantity'),)),item,()),
          Metric('refund_inr',Expr('sum',args=(ref('Returns.refund'),)),currency,()))
 features=validate_model(Model('invoice-profile-v1',objects,metrics=metrics))
 print(json.dumps({'valid':True,'profile':'invoice-v1','required_features':sorted(features)}))
except Exception:
 print(json.dumps({'valid':False,'code':'unsupported_definition_profile'}));sys.exit(1)
