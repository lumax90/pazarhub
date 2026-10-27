import type { IntegrationOperation } from '../../src/domain/integrations'
import type { Shipment } from '../../src/domain/types'
import { ProviderError } from '../errors'
import type { AdapterContext, AdapterResult, ProviderAdapter } from './contracts'
import { record, text } from './contracts'
import { ProviderHttp, requireCredential } from './http'
import { qualifiedFields, soapArray, soapCall } from './soap'

export function shipmentFor(
  context: AdapterContext,
  payload: Record<string, unknown>,
): Shipment & Required<Pick<Shipment, 'recipient' | 'packages' | 'desi' | 'weight'>> {
  const shipment = context.state.shipments?.find(
    (item) => item.id === payload.shipmentId && item.connectionId === context.connectionId,
  )
  if (!shipment?.recipient || !shipment.packages || !shipment.desi || !shipment.weight)
    throw new ProviderError('SHIPMENT_NOT_FOUND', 'Gönderi, ölçü veya alıcı bilgileri bulunamadı.')
  return shipment as Shipment &
    Required<Pick<Shipment, 'recipient' | 'packages' | 'desi' | 'weight'>>
}
function assertLive(context: AdapterContext) {
  if (context.settings.environment === 'sandbox')
    throw new ProviderError(
      'NO_SEPARATE_SANDBOX',
      'Bu taşıyıcıda ayrı sandbox adresi tanımlı değil. Test hesabının web servis bilgilerini kullanın.',
    )
}
export class YurticiAdapter implements ProviderAdapter {
  capabilities: readonly IntegrationOperation[] = [
    'test',
    'shipment.create',
    'shipment.track',
    'shipment.cancel',
    'shipment.reconcile',
  ]
  constructor(private readonly http: ProviderHttp) {}
  async execute(
    operation: IntegrationOperation,
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    assertLive(context)
    const endpoint = 'https://ws.yurticikargo.com/KOPSWebServices/ShippingOrderDispatcherServices',
      namespace = 'http://yurticikargo.com.tr/ShippingOrderDispatcherServices'
    const auth = {
      wsUserName: requireCredential(context.credentials, 'username'),
      wsPassword: requireCredential(context.credentials, 'password'),
    }
    const shipment = operation === 'test' ? undefined : shipmentFor(context, payload)
    if (
      operation === 'test' ||
      operation === 'shipment.track' ||
      operation === 'shipment.reconcile'
    ) {
      const key = shipment?.reference ?? requireCredential(context.credentials, 'testReference')
      const response = await soapCall(
        this.http,
        endpoint,
        namespace,
        'queryShipment',
        {
          ...auth,
          wsLanguage: 'TR',
          keys: [key],
          keyType: 0,
          addHistoricalData: false,
          onlyTracking: false,
        },
        { action: '', safe: true },
      )
      const data = record(response.ShippingDeliveryVO),
        detail = soapArray(data.shippingDeliveryDetailVO)
          .map(record)
          .find((item) => text(item.cargoKey) === key),
        item = record(detail?.shippingDeliveryItemDetailVO)
      if (
        text(data.outFlag) !== '0' ||
        !detail ||
        (text(detail.errCode) && text(detail.errCode) !== '0')
      )
        throw new ProviderError(
          'CARGO_QUERY_REJECTED',
          'Yurtiçi kaydı okunamadı. Web servis bilgilerini ve hesaba ait kargo referansını kontrol edin.',
        )
      if (operation === 'test')
        return { message: 'Yurtiçi hesabına ait referans salt okuma ile doğrulandı.' }
      const delivered = !!text(item.deliveryDate) && !/^0+$/.test(text(item.deliveryDate))
      return {
        message: delivered
          ? 'Yurtiçi teslimatı doğrulandı.'
          : 'Yurtiçi gönderi durumu güncellendi.',
        shipment: {
          externalId: shipment!.reference,
          trackingNumber: text(item.docId) || shipment!.trackingNumber,
          status: delivered ? 'delivered' : text(item.documentDate) ? 'in_transit' : 'created',
        },
      }
    }
    if (operation === 'shipment.create') {
      const recipient = shipment!.recipient!
      const response = await soapCall(
        this.http,
        endpoint,
        namespace,
        'createShipment',
        {
          ...auth,
          userLanguage: 'TR',
          ShippingOrderVO: [
            {
              cargoKey: shipment!.reference,
              invoiceKey: shipment!.reference,
              receiverCustName: recipient.name,
              receiverAddress: recipient.address,
              cityName: recipient.city,
              townName: recipient.district,
              receiverPhone1: recipient.phone,
              taxOfficeId: 0,
              desi: shipment!.desi,
              kg: shipment!.weight,
              cargoCount: shipment!.packages,
              ttDocumentId: 0,
              dcSelectedCredit: 0,
              dcCreditRule: 0,
              description: `Pazarhub ${shipment!.reference}`,
            },
          ],
        },
        { action: '' },
      )
      const data = record(response.ShippingOrderResultVO),
        detail = soapArray(data.shippingOrderDetailVO)
          .map(record)
          .find((item) => text(item.cargoKey) === shipment!.reference)
      if (
        text(data.outFlag) !== '0' ||
        !detail ||
        (text(detail.errCode) && text(detail.errCode) !== '0')
      )
        throw new ProviderError(
          'SHIPMENT_REJECTED',
          'Yurtiçi gönderi kaydını kabul etmedi. Alıcı, ilçe ve desi bilgilerini kontrol edin.',
        )
      return {
        message: 'Yurtiçi gönderi kaydı oluşturuldu. Kargoya kabul bilgisi takipten alınacak.',
        reference: shipment!.reference,
        shipment: { externalId: shipment!.reference, status: 'created' },
      }
    }
    if (operation === 'shipment.cancel') {
      const response = await soapCall(
        this.http,
        endpoint,
        namespace,
        'cancelShipment',
        { ...auth, userLanguage: 'TR', cargoKeys: [shipment!.reference] },
        { action: '' },
      )
      const data = record(response.ShippingOrderResultVO),
        details = soapArray(data.shippingCancelDetailVO).map(record)
      if (
        text(data.outFlag) !== '0' ||
        !details.length ||
        details.some((item) => text(item.errCode) && text(item.errCode) !== '0')
      )
        throw new ProviderError('CANCEL_REJECTED', 'Yurtiçi gönderi iptalini kabul etmedi.')
      return {
        message: 'Yurtiçi gönderi kaydı iptal edildi.',
        shipment: { externalId: shipment!.reference, status: 'cancelled' },
      }
    }
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Bu Yurtiçi işlemi kullanıma açık değil.')
  }
}

export class ArasAdapter implements ProviderAdapter {
  capabilities: readonly IntegrationOperation[] = [
    'test',
    'shipment.create',
    'shipment.track',
    'shipment.reconcile',
  ]
  constructor(private readonly http: ProviderHttp) {}
  async execute(
    operation: IntegrationOperation,
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    assertLive(context)
    const endpoint = 'https://customerws.araskargo.com.tr/arascargoservice.asmx',
      namespace = 'http://tempuri.org/'
    const userName = requireCredential(context.credentials, 'username'),
      password = requireCredential(context.credentials, 'password')
    const call = (method: string, body: Record<string, unknown>, safe = false) =>
      soapCall(this.http, endpoint, namespace, method, body, {
        qualified: true,
        action: `${namespace}${method}`,
        safe,
      })
    if (operation === 'test') {
      const reference = requireCredential(context.credentials, 'testReference')
      const response = await call(
        'GetOrderWithIntegrationCode',
        { userName, password, integrationCode: reference },
        true,
      )
      if (
        !soapArray(record(response.GetOrderWithIntegrationCodeResult).Order)
          .map(record)
          .some((order) => text(order.IntegrationCode) === reference)
      )
        throw new ProviderError(
          'REFERENCE_NOT_FOUND',
          'Aras test referansı bu hesapta okunamadı. Hesaba ait entegrasyon kodunu girin.',
        )
      return { message: 'Aras hesabına ait gönderi referansı doğrulandı.' }
    }
    const shipment = shipmentFor(context, payload)
    if (operation === 'shipment.reconcile') {
      const response = await call(
        'GetOrderWithIntegrationCode',
        { userName, password, integrationCode: shipment.reference },
        true,
      )
      const matches = soapArray(record(response.GetOrderWithIntegrationCodeResult).Order)
        .map(record)
        .filter((item) => text(item.IntegrationCode) === shipment.reference)
      if (matches.length !== 1)
        throw new ProviderError(
          'SHIPMENT_NOT_CONFIRMED',
          'Aras referansı tek bir kayıtla doğrulanamadı. Yeni gönderi oluşturulmadı.',
        )
      return this.execute('shipment.create', context, { ...payload, stage: 'label' })
    }
    if (operation === 'shipment.create' && payload.stage !== 'label') {
      const r = shipment.recipient!
      const response = await call('SetOrder', {
        orderInfo: {
          Order: [
            {
              UserName: userName,
              Password: password,
              TradingWaybillNumber: shipment.reference,
              ReceiverName: r.name,
              ReceiverAddress: r.address,
              ReceiverPhone1: r.phone,
              ReceiverCityName: r.city,
              ReceiverTownName: r.district,
              VolumetricWeight: String(shipment.desi),
              Weight: String(shipment.weight),
              PieceCount: String(shipment.packages),
              IntegrationCode: shipment.reference,
              Description: `Pazarhub ${shipment.reference}`,
              CountryCode: 'TR',
              PayorTypeCode: '1',
              IsWorldWide: '0',
              IsCod: '0',
            },
          ],
        },
        userName,
        password,
      })
      const result = soapArray(record(response.SetOrderResult).OrderResultInfo).map(record)[0]
      if (!result || text(result.ResultCode) !== '0')
        throw new ProviderError(
          'SHIPMENT_REJECTED',
          'Aras gönderi kaydını kabul etmedi. Adres, ilçe ve sözleşme bilgilerini kontrol edin.',
        )
      return {
        message: 'Aras gönderisi oluşturuldu; taşıyıcı etiketi hazırlanıyor.',
        reference: shipment.reference,
        shipment: { externalId: shipment.reference, status: 'created' },
        nextPayload: { ...payload, stage: 'label' },
        delaySeconds: 5,
      }
    }
    if (operation === 'shipment.create') {
      const response = await call(
        'GetBarcode',
        { Username: userName, Password: password, integrationCode: shipment.reference },
        true,
      )
      const result = record(response.GetBarcodeResult),
        barcode = soapArray(record(result.BarcodeModelLst).BarcodeModel).map(record)[0]
      if (!barcode?.TrackingNumber)
        throw new ProviderError(
          'LABEL_PENDING',
          'Aras barkodu henüz alınamadı. Gönderi referansı oluşturuldu; etiket tekrar sorgulanabilir.',
          true,
          30,
        )
      const image = text(soapArray(record(result.Images).base64Binary)[0])
      return {
        message: 'Aras taşıyıcı barkodu alındı.',
        shipment: {
          externalId: shipment.reference,
          trackingNumber: text(barcode.TrackingNumber),
          status: 'created',
          ...(image ? { label: { data: image, encoding: 'base64', mime: 'image/png' } } : {}),
        },
      }
    }
    if (operation === 'shipment.track') {
      if (!shipment.trackingNumber)
        throw new ProviderError('TRACKING_REQUIRED', 'Önce taşıyıcı barkodu alınmalı.')
      const response = await call(
        'GetDeliveryInfodocID',
        { userName, password, language: 'TR', docID: { string: [shipment.trackingNumber] } },
        true,
      )
      const detail = soapArray(record(response.GetDeliveryInfodocIDResult).DeliveryInfo)
        .map(record)
        .find((item) => text(item.DocID) === shipment.trackingNumber)
      if (!detail)
        throw new ProviderError(
          'TRACKING_PENDING',
          'Aras teslimat hareketi henüz bulunamadı.',
          true,
          300,
        )
      const delivered = !!text(detail.DeliveryDate) && !/^0+$/.test(text(detail.DeliveryDate))
      return {
        message: 'Aras teslimat hareketi okundu.',
        shipment: {
          externalId: shipment.reference,
          trackingNumber: shipment.trackingNumber,
          status: delivered ? 'delivered' : text(detail.ArrivalDate) ? 'in_transit' : 'created',
        },
      }
    }
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Bu Aras işlemi kullanıma açık değil.')
  }
}

export class PttCargoAdapter implements ProviderAdapter {
  capabilities: readonly IntegrationOperation[] = [
    'test',
    'shipment.create',
    'shipment.track',
    'shipment.cancel',
    'shipment.reconcile',
  ]
  constructor(private readonly http: ProviderHttp) {}
  async execute(
    operation: IntegrationOperation,
    context: AdapterContext,
    payload: Record<string, unknown>,
  ): Promise<AdapterResult> {
    assertLive(context)
    const customer = requireCredential(context.credentials, 'customerCode'),
      password = requireCredential(context.credentials, 'password'),
      username = requireCredential(context.credentials, 'username')
    const call = (
      service: 'PttVeriYukleme' | 'GonderiHareketV2',
      method: string,
      input: Record<string, unknown>,
      safe = false,
    ) => {
      const ns =
        service === 'PttVeriYukleme' ? 'http://kabul.ptt.gov.tr' : 'http://hareket.ptt.gov.tr'
      return soapCall(
        this.http,
        `https://pttws.ptt.gov.tr/${service}/services/Sorgu`,
        ns,
        method,
        { 'm:input': { '@_xmlns:t': `${ns}/xsd`, ...qualifiedFields(input) } },
        { action: `urn:${method}`, safe },
      )
    }
    const shipment = operation === 'test' ? undefined : shipmentFor(context, payload)
    if (
      operation === 'test' ||
      operation === 'shipment.track' ||
      operation === 'shipment.reconcile'
    ) {
      const barcode =
        operation === 'test'
          ? requireCredential(context.credentials, 'testReference')
          : shipment?.trackingNumber || shipment?.carrierBarcode
      if (!barcode)
        throw new ProviderError(
          'TRACKING_REQUIRED',
          'Gönderiye tahsis edilmiş PTT barkodu gerekli.',
        )
      const result = record(
        (
          await call(
            'GonderiHareketV2',
            'barkodSorgu',
            { barkod: barcode, kullanici: username, musteri_no: Number(customer), sifre: password },
            true,
          )
        ).return,
      )
      if (text(result.hataKodu) !== '0' || text(result.barkod) !== barcode)
        throw new ProviderError(
          'PTT_QUERY_FAILED',
          'PTT barkodu bu hesapla sorgulanamadı. Referansı ve web servis yetkisini kontrol edin.',
        )
      if (operation === 'test') return { message: 'PTT hesabına ait gönderi barkodu doğrulandı.' }
      const delivered =
        !!text(result.aliciTeslimTarih) && !/^0+$/.test(text(result.aliciTeslimTarih))
      let label: NonNullable<AdapterResult['shipment']>['label']
      if (operation === 'shipment.reconcile' && payload.sourceOperation === 'shipment.create') {
        const state = structuredClone(context.state)
        const current = state.shipments!.find((item) => item.id === shipment!.id)!
        current.trackingNumber = barcode
        const result = await this.execute(
          'shipment.create',
          { ...context, state },
          { ...payload, stage: 'label' },
        )
        label = result.shipment?.label
      }
      return {
        message: 'PTT gönderi hareketi okundu.',
        shipment: {
          externalId: shipment!.reference,
          trackingNumber: barcode,
          ...(label ? { label } : {}),
          status: delivered ? 'delivered' : text(result.kabulTarih) ? 'in_transit' : 'created',
        },
      }
    }
    if (operation === 'shipment.create' && payload.stage !== 'label') {
      const r = shipment!.recipient!,
        barcode = shipment!.carrierBarcode
      if (!barcode)
        throw new ProviderError(
          'BARCODE_REQUIRED',
          'PTT sözleşmenize tahsis edilen kullanılmamış barkodu girin.',
        )
      if (shipment!.packages !== 1)
        throw new ProviderError(
          'PTT_PARCEL_LIMIT',
          'PTT parçalı barkod sözleşmesi için her koli ayrı gönderi olarak oluşturulmalı.',
        )
      const result = record(
        (
          await call('PttVeriYukleme', 'kabulEkle2', {
            dongu: [
              {
                aAdres: r.address,
                agirlik: Math.round(shipment!.weight * 1000),
                aliciAdi: r.name,
                aliciIlAdi: r.city,
                aliciIlceAdi: r.district,
                aliciTel: r.phone,
                barkodNo: barcode,
                desi: shipment!.desi,
                gondericibilgi: {
                  gonderici_adi: context.settings.senderName,
                  gonderici_adresi: context.settings.senderAddress,
                  gonderici_il_ad: context.settings.senderCity,
                  gonderici_ilce_ad: context.settings.senderDistrict,
                  gonderici_telefonu: context.settings.senderPhone,
                  gonderici_ulke_id: 'TR',
                },
                musteriReferansNo: shipment!.reference,
              },
            ],
            dosyaAdi: shipment!.reference,
            gonderiTip: requireCredential(context.credentials, 'shipmentType'),
            gonderiTur: requireCredential(context.credentials, 'shipmentKind'),
            kullanici: username,
            musteriId: Number(customer),
            sifre: password,
          })
        ).return,
      )
      const detail = soapArray(result.dongu).map(record)[0]
      if (text(result.hataKodu) !== '0' || !detail || text(detail.donguSonuc) !== 'true')
        throw new ProviderError(
          'PTT_CREATE_FAILED',
          'PTT gönderi kaydını kabul etmedi. Barkod tahsisini ve gönderi türünü kontrol edin.',
        )
      return {
        message: 'PTT gönderi kaydı oluşturuldu; etiket alınıyor.',
        reference: shipment!.reference,
        shipment: {
          externalId: shipment!.reference,
          trackingNumber: text(detail.barkod) || barcode,
          status: 'created',
        },
        nextPayload: { ...payload, stage: 'label' },
        delaySeconds: 5,
      }
    }
    if (operation === 'shipment.create') {
      const result = record(
        (
          await call(
            'PttVeriYukleme',
            'etiketGetir',
            { barkodNo: shipment!.trackingNumber, musteriId: Number(customer), sifre: password },
            true,
          )
        ).return,
      )
      if (text(result.hataKodu) !== '0' || !text(result.epl_format))
        throw new ProviderError(
          'PTT_LABEL_FAILED',
          'PTT etiketi henüz alınamadı; gönderi kaydı oluşturuldu.',
          true,
          30,
        )
      return {
        message: 'PTT EPL etiketi alındı.',
        shipment: {
          externalId: shipment!.reference,
          trackingNumber: shipment!.trackingNumber,
          status: 'created',
          label: { data: text(result.epl_format), encoding: 'utf8', mime: 'text/plain' },
        },
      }
    }
    if (operation === 'shipment.cancel') {
      const result = record(
        (
          await call('PttVeriYukleme', 'barkodVeriSil', {
            barcode: shipment!.trackingNumber,
            dosyaAdi: shipment!.reference,
            musteriId: Number(customer),
            sifre: password,
          })
        ).return,
      )
      if (text(result.hataKodu) !== '0')
        throw new ProviderError(
          'PTT_CANCEL_FAILED',
          'PTT iptali kabul etmedi. Kargoya kabul edilmiş kayıtlar silinemez.',
        )
      return {
        message: 'PTT gönderi kaydı iptal edildi.',
        shipment: { externalId: shipment!.reference, status: 'cancelled' },
      }
    }
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Bu PTT işlemi kullanıma açık değil.')
  }
}
