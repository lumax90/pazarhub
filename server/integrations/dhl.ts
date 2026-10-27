import type { IntegrationOperation } from '../../src/domain/integrations'
import { ProviderError } from '../errors'
import { array, record, text, pathPart } from './contracts'
import type { AdapterContext, AdapterResult, ProviderAdapter } from './contracts'
import { ProviderHttp, requireCredential } from './http'
import { shipmentFor } from './cargo'

const fold = (value: string) =>
  value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('ı', 'i')
    .replace(/[^a-z0-9]/g, '')
export class DhlAdapter implements ProviderAdapter {
  capabilities: readonly IntegrationOperation[] = [
    'test',
    'shipment.create',
    'shipment.track',
    'shipment.cancel',
  ]
  constructor(private readonly http: ProviderHttp) {}
  async execute(
    operation: IntegrationOperation,
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    const base =
      context.settings.environment === 'sandbox'
        ? 'https://testapi.mngkargo.com.tr/mngapi/api'
        : 'https://api.mngkargo.com.tr/mngapi/api'
    const appHeaders = {
      'x-ibm-client-id': requireCredential(context.credentials, 'clientId'),
      'x-ibm-client-secret': requireCredential(context.credentials, 'clientSecret'),
    }
    const auth = record(
      await this.http.request(`${base}/token`, {
        method: 'POST',
        headers: appHeaders,
        json: {
          customerNumber: requireCredential(context.credentials, 'customerNumber'),
          password: requireCredential(context.credentials, 'password'),
          identityType: 1,
        },
        idempotent: true,
      }),
    )
    if (!text(auth.jwt))
      throw new ProviderError('TOKEN_REJECTED', 'DHL eCommerce erişim anahtarı alınamadı.')
    const headers = { ...appHeaders, authorization: `Bearer ${text(auth.jwt)}` }
    if (operation === 'test')
      return { message: 'DHL eCommerce uygulama ve müşteri hesabı kimlik doğrulaması başarılı.' }
    const shipment = shipmentFor(context, payload)
    if (operation === 'shipment.create') {
      const pieces = Array.from({ length: shipment.packages }, (_, index) => ({
        barcode:
          shipment.packages === 1 ? shipment.reference : `${shipment.reference}_PARCA${index + 1}`,
        desi: Number((shipment.desi / shipment.packages).toFixed(2)),
        kg: Number((shipment.weight / shipment.packages).toFixed(2)),
        content: 'Sipariş ürünleri',
      }))
      if (!payload.orderCreated) {
        const cities = await this.http.request(`${base}/cbsinfoapi/getcities`, { headers })
        const city = array(cities)
          .map(record)
          .find((item) => fold(text(item.name)) === fold(shipment.recipient.city))
        if (!city || !text(city.code))
          throw new ProviderError(
            'CITY_NOT_FOUND',
            'DHL alıcı il kodu bulunamadı. İl adını kontrol edin.',
          )
        const districts = await this.http.request(
          `${base}/cbsinfoapi/getdistricts/${pathPart(text(city.code))}`,
          { headers },
        )
        const district = array(districts)
          .map(record)
          .find((item) => fold(text(item.name)) === fold(shipment.recipient.district))
        if (!district || !text(district.code))
          throw new ProviderError(
            'DISTRICT_NOT_FOUND',
            'DHL alıcı ilçe kodu bulunamadı. İlçeyi kontrol edin.',
          )
        const r = shipment.recipient
        const result = await this.http.request(`${base}/standardcmdapi/createOrder`, {
          method: 'POST',
          headers,
          json: {
            order: {
              referenceId: shipment.reference,
              barcode: shipment.reference,
              billOfLandingId: '',
              isCOD: 0,
              codAmount: 0,
              shipmentServiceType: 1,
              packagingType: 3,
              content: 'Sipariş ürünleri',
              smsPreference1: 0,
              smsPreference2: 0,
              smsPreference3: 0,
              paymentType: 1,
              deliveryType: 1,
              description: `Pazarhub ${shipment.reference}`,
            },
            orderPieceList: pieces,
            recipient: {
              customerId: '',
              refCustomerId: '',
              cityCode: Number(city.code),
              districtCode: Number(district.code),
              cityName: r.city,
              districtName: r.district,
              address: r.address,
              fullName: r.name,
              mobilePhoneNumber: r.phone.replace(/\D/g, '').slice(-10),
              bussinessPhoneNumber: '',
              homePhoneNumber: '',
              email: '',
              taxOffice: '',
              taxNumber: '',
            },
          },
        })
        const data = record(Array.isArray(result) ? result[0] : result)
        if (text(data.referenceId) !== shipment.reference || !text(data.orderInvoiceId))
          throw new ProviderError(
            'ORDER_UNCERTAIN',
            'DHL gönderi isteğinin sonucu doğrulanamadı.',
            false,
            undefined,
            true,
          )
        return {
          message: 'DHL gönderi siparişi oluşturuldu; taşıyıcı barkodu alınacak.',
          reference: shipment.reference,
          shipment: { externalId: text(data.orderInvoiceId), status: 'created' },
          nextPayload: { ...payload, orderCreated: true },
          delaySeconds: 3,
        }
      }
      const result = await this.http.request(`${base}/barcodecmdapi/createbarcode`, {
        method: 'POST',
        headers,
        json: {
          referenceId: shipment.reference,
          billOfLandingId: '',
          isCOD: 0,
          codAmount: 0,
          printReferenceBarcodeOnError: 0,
          message: '',
          packagingType: 3,
          orderPieceList: pieces,
        },
      })
      const entries = Array.isArray(result) ? result : [result]
      const data = record(entries[0]),
        labels = entries
          .flatMap((entry) => array(record(entry).barcodes).map((code) => text(record(code).value)))
          .filter(Boolean)
      if (text(data.referenceId) !== shipment.reference || !text(data.shipmentId) || !labels.length)
        throw new ProviderError(
          'BARCODE_UNCERTAIN',
          'DHL barkod sonucu doğrulanamadı. Mevcut gönderi referansını kontrol edin.',
          false,
          undefined,
          true,
        )
      return {
        message: 'DHL taşıyıcı barkodu ve ZPL etiketleri alındı.',
        shipment: {
          externalId: text(data.shipmentId),
          trackingNumber: text(data.shipmentId),
          status: 'created',
          label: { data: labels.join('\n'), encoding: 'utf8', mime: 'text/plain' },
        },
      }
    }
    if (operation === 'shipment.track') {
      if (!shipment.trackingNumber)
        throw new ProviderError('TRACKING_REQUIRED', 'DHL taşıyıcı barkodu henüz oluşmadı.')
      const result = await this.http.request(
        `${base}/standardqueryapi/trackshipmentByShipmentId/${pathPart(shipment.trackingNumber)}`,
        { headers },
      )
      if (!Array.isArray(result) || !result.length)
        throw new ProviderError(
          'TRACKING_PENDING',
          'DHL gönderi hareketi henüz oluşmadı.',
          true,
          300,
        )
      const last = record(result.at(-1)),
        status = fold(text(last.eventStatus))
      const mapped =
        status === 'teslimedildi'
          ? 'delivered'
          : ['transferasamasinda', 'teslimatbirimineulasti', 'aliciadresineyonlendirildi'].includes(
                status,
              )
            ? 'in_transit'
            : status === 'gonderihazirlandi'
              ? 'created'
              : undefined
      if (!mapped)
        throw new ProviderError(
          'SHIPMENT_EXCEPTION',
          'DHL gönderisinde teslimat istisnası var. Taşıyıcı takip kaydını kontrol edin.',
        )
      return {
        message: 'DHL gönderi durumu güncellendi.',
        shipment: {
          externalId: shipment.externalId!,
          trackingNumber: shipment.trackingNumber,
          status: mapped,
        },
      }
    }
    if (operation === 'shipment.cancel') {
      if (!shipment.trackingNumber)
        throw new ProviderError('SHIPMENT_NOT_READY', 'DHL barkod oluşumu tamamlanmalı.')
      await this.http.request(`${base}/barcodecmdapi/cancelshipment`, {
        method: 'PUT',
        headers,
        json: { referenceId: shipment.reference, shipmentId: shipment.externalId },
        idempotent: true,
      })
      return {
        message: 'DHL gönderi iptali kabul edildi.',
        shipment: { externalId: shipment.externalId!, status: 'cancelled' },
      }
    }
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Bu DHL işlemi kullanıma açık değil.')
  }
}
