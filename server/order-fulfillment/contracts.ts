import type { Order } from '../../src/domain/types'
import type { OrderFulfillmentPlan, OrderFulfillmentView } from '../../src/domain/order-fulfillment'
import type { AdapterContext, AdapterResult } from '../integrations/contracts'
import { canonicalJson, sha256 } from '../security'
import { orderContentKey } from '../../src/domain/orders'

export interface MarketplaceFulfillmentAdapter {
  load(context: AdapterContext, order: Order): Promise<OrderFulfillmentView>
  execute(
    context: AdapterContext,
    order: Order,
    plan: OrderFulfillmentPlan,
    checking: boolean,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult>
}
export const fulfillmentLocalKey = (order: Order) =>
  sha256(
    canonicalJson({
      content: orderContentKey(order),
      shipping: order.shippingAddress,
      externalId: order.externalId,
    }),
  )
export const fulfillmentRemoteKey = (value: unknown) => sha256(canonicalJson(value))
export const packageStatus = (value: unknown) =>
  String(value ?? '')
    .toLocaleLowerCase('en-US')
    .replace(/[ _-]/g, '')
export const isCancelled = (value: unknown) =>
  ['unsupplied', 'cancelled', 'canceled'].some((status) => packageStatus(value).startsWith(status))
