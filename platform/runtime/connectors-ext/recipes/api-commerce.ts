import type { Decoder, SourceRecipe } from '../recipe.ts';
import { SHOPIFY_NOTICES } from '../../adapters/commerce/shopify.ts';
import { WOOCOMMERCE_NOTICES } from '../../adapters/commerce/woocommerce.ts';

/**
 * Store orders read by the adapters in runtime/adapters/commerce. Field aliases are the flattened
 * dotted keys of the source JSON; money is decimal text in major units. Both stores declare an
 * order count (checked by the read runner) but no amount, so the amount total is the report total.
 */
const shopifyOrders: SourceRecipe = {
  id: 'shopify.orders', version: '1', group: 'shopify', operation: 'orders', title: 'Shopify orders', decoder: 'api-records',
  fields: {
    id: { from: ['id'], type: 'text', required: true },
    name: { from: ['name'], type: 'text', required: true },
    date: { from: ['processedAt'], type: 'date', required: true, dateFormats: ['ISO-DATETIME-IST'] },
    subtotal: { from: ['subtotalPriceSet.shopMoney.amount'], type: 'money', required: true },
    currency: { from: ['subtotalPriceSet.shopMoney.currencyCode'], type: 'text', required: true },
    tax: { from: ['totalTaxSet.shopMoney.amount'], type: 'money' },
    financialStatus: { from: ['displayFinancialStatus'], type: 'text', required: true },
    cancelledAt: { from: ['cancelledAt'], type: 'text' },
  },
  measure: { type: 'money', amount: { field: 'subtotal' }, currency: { field: 'currency' }, unit: 'major' },
  identity: ['id'], kind: { constant: 'order' },
  status: { field: 'financialStatus', values: { PAID: 'paid', PENDING: 'pending', AUTHORIZED: 'authorized', PARTIALLY_PAID: 'partially_paid',
    PARTIALLY_REFUNDED: 'partially_refunded', REFUNDED: 'refunded', VOIDED: 'void', EXPIRED: 'expired' } },
  outputs: { orderId: 'name', taxMinor: 'tax' },
  totals: { kind: 'report' },
  ignored: ['currencyCode', 'totalTaxSet.shopMoney.currencyCode'],
  notices: [...SHOPIFY_NOTICES],
  sensitivity: 'financial',
};

const woocommerceOrders: SourceRecipe = {
  id: 'woocommerce.orders', version: '1', group: 'woocommerce', operation: 'orders', title: 'WooCommerce orders', decoder: 'api-records',
  fields: {
    id: { from: ['id'], type: 'text', required: true },
    number: { from: ['number'], type: 'text' },
    date: { from: ['date_created'], type: 'date', required: true, dateFormats: ['ISO-DATETIME'] },
    total: { from: ['total'], type: 'money', required: true },
    tax: { from: ['total_tax'], type: 'money' },
    shipping: { from: ['shipping_total'], type: 'money' },
    currency: { from: ['currency'], type: 'text', required: true },
    status: { from: ['status'], type: 'text', required: true },
    customerId: { from: ['customer_id'], type: 'text' },
    paymentMethod: { from: ['payment_method_title'], type: 'text' },
  },
  measure: { type: 'money', amount: { field: 'total' }, currency: { field: 'currency' }, unit: 'major' },
  identity: ['id'], kind: { constant: 'order' },
  status: { field: 'status', values: { pending: 'pending', processing: 'processing', 'on-hold': 'on_hold', completed: 'completed', cancelled: 'cancelled',
    refunded: 'refunded', failed: 'failed', 'checkout-draft': 'draft', trash: 'deleted' } },
  outputs: { orderId: 'number', taxMinor: 'tax', shippingMinor: 'shipping', customerId: 'customerId', paymentMethod: 'paymentMethod' },
  totals: { kind: 'report' },
  notices: [...WOOCOMMERCE_NOTICES],
  sensitivity: 'financial',
};

export const RECIPES: readonly SourceRecipe[] = [shopifyOrders, woocommerceOrders];
export const DECODERS: readonly Decoder[] = [];
