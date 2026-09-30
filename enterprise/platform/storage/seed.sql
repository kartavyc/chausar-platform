-- Synthetic fixture only. Run once after schema.sql in the dedicated test database.
BEGIN;
INSERT INTO chausar_core.tenants(tenant_id,active) VALUES ('demo',true),('other',true);
INSERT INTO chausar_core.principals(tenant_id,principal_id,kind) VALUES
 ('demo','leader','human'),('demo','north-leader','human'),('demo','owner','human'),
 ('demo','agent','service'),('demo','north-agent','service'),('other','leader','human');
UPDATE chausar_core.principals SET capabilities=ARRAY['publish_ontology'] WHERE tenant_id='demo' AND principal_id='owner';
INSERT INTO chausar_core.policy_revisions VALUES
 ('demo','business',1,'{"retention_seconds":3600}'::jsonb),
 ('other','business',1,'{"retention_seconds":3600}'::jsonb);
INSERT INTO chausar_core.policies VALUES ('demo','business',1,true),('other','business',1,true);
INSERT INTO chausar_core.datasets VALUES
 ('demo','invoices',true,1,ARRAY['amount','discount','cost','currency','fx_to_inr','region','customer_id','invoice_id','invoice_date']),
 ('other','invoices',true,1,ARRAY['amount','discount','cost','currency','fx_to_inr','region','customer_id','invoice_id','invoice_date']);
INSERT INTO chausar_core.grants(tenant_id,grant_id,principal_id,dataset_id,purpose,operations,fields,regions,policy_id,expires_at) VALUES
 ('demo','broad','leader','invoices','profitability',ARRAY['read','retain','release'],ARRAY['amount','discount','cost','currency','fx_to_inr','region','customer_id','invoice_id','invoice_date'],ARRAY['north','south'],'business',clock_timestamp()+interval '1 day'),
 ('demo','north','north-leader','invoices','profitability',ARRAY['read','retain','release'],ARRAY['amount','discount','cost','currency','fx_to_inr','region','customer_id','invoice_id','invoice_date'],ARRAY['north'],'business',clock_timestamp()+interval '1 day'),
 ('demo','mandate','agent','invoices','profitability',ARRAY['read','retain','release'],ARRAY['amount','discount','cost','currency','fx_to_inr','region','customer_id','invoice_id','invoice_date'],ARRAY['north','south'],'business',clock_timestamp()+interval '1 day');
INSERT INTO chausar_core.grants(tenant_id,grant_id,principal_id,dataset_id,purpose,operations,fields,regions,policy_id,expires_at)
 SELECT 'demo','north-mandate','north-agent',dataset_id,purpose,operations,fields,ARRAY['north'],policy_id,expires_at
 FROM chausar_core.grants WHERE tenant_id='demo' AND grant_id='mandate';
UPDATE chausar_core.datasets SET permitted_fields=permitted_fields || ARRAY['shipment_quantity','refund'] WHERE tenant_id='demo';
UPDATE chausar_core.grants SET fields=fields || ARRAY['shipment_quantity','refund'] WHERE tenant_id='demo';
INSERT INTO chausar_core.mandates VALUES ('demo','watch-profit','agent','mandate','active',1),('demo','watch-north','north-agent','north-mandate','active',1);
INSERT INTO chausar_core.mandate_owners VALUES ('demo','watch-profit','owner',true),('demo','watch-profit','leader',true),('demo','watch-north','north-leader',true);
INSERT INTO chausar_source.invoices(tenant_id,invoice_id,region,customer_id,amount,discount,cost,currency,fx_to_inr,invoice_date) VALUES
 ('demo',1,'north','A',100,10,60,'INR',1,'2026-03-31'),
 ('demo',2,'north','A',200,20,120,'INR',1,'2026-04-01'),
 ('demo',3,'south','B',300,30,NULL,'USD',80,'2027-02-01'),
 ('demo',4,'south','C',400,40,240,'INR',1,'2027-04-01'),
 ('other',1,'north','SECRET',999999,0,0,'INR',1,'2026-04-01');
UPDATE chausar_source.invoices SET order_id=CASE WHEN invoice_id IN (1,2) THEN 10 ELSE 20 END WHERE tenant_id='demo';
INSERT INTO chausar_source.orders VALUES ('demo',10,'open'),('demo',20,'closed');
INSERT INTO chausar_source.shipments VALUES ('demo',1,1,2),('demo',2,1,3),('demo',3,2,4),('demo',4,3,5),('demo',5,3,6);
INSERT INTO chausar_source.returns VALUES ('demo',1,1,10),('demo',2,1,5),('demo',3,2,20),('demo',4,4,40);
COMMIT;
