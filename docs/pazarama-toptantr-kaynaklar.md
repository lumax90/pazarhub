# Pazarama ve ToptanTR — doğrulanan sözleşmeler

Araştırma tarihi: 23 Ekim 2026. Bunlar resmî dokümanlardan doğrulanan API sözleşmeleridir; gerçek satıcı hesabında kabul sonucu değildir.

## Pazarama

- Ana belge: <https://isortagim.pazarama.com/auth/integration>
- Token: `token-alma` — son güncelleme 14.10.2026. `POST https://isortagimgiris.pazarama.com/connect/token`, Basic `clientId:clientSecret`, form gövdesinde `grant_type=client_credentials` ve `scope=merchantgatewayapi.fullaccess`. Token ömrü bir saat.
- API kökü: `https://isortagimapi.pazarama.com`.
- Onaylı katalog: `/product/products/approved`, `Size` ve opak `Cursor`; `data.sellerProducts` ve `data.nextCursor`. Onaysız katalog ayrı `/product/products/unapproved`; `pageIndex/pageSize`. Belge son güncelleme 14.10.2026.
- Fiyat/stok: `/product/updatePrice-v2`, `/product/updateStock-v2`; satıcı bazında yazmalar arasında 10 saniye. İşlem sonucu `/listing-state/batch-id/{id}/lake-projections` üzerinden doğrulanır. İç `price.status=0` tek başına yeterli değildir; dış `operationStatusText` fiyat onayı beklediğini bildirebilir.
- Sipariş: `POST /order/getOrdersForApi`; örneklerde 1 tabanlı `pageNumber`, en fazla bir aylık tarih aralığı ve bitiş tarihi dışlayıcıdır. Tutar zarfındaki `valueInt` kuruştur. Saat dilimi olmayan yerel tarihler İstanbul saatiyle yorumlanır.
- Ürün yayınlama: `/product/create`; GUID kategori/marka/özellik değerleri kullanılır. Tek ürün isteğinde dönen sıfır GUID gerçek bir batch değildir; bu durumda katalog onayı izlenir. Diğer batch sonuçları `/product/getProductBatchResult` ile alınır.
- Kategoriler: `/category/getCategoryTree`, `/category/getCategoryWithAttributes`; marka araması `/brand/getBrands`.
- Fatura linki: `POST /order/invoice-link`.

### Uygulanan kontroller

Stok önce gönderilir. Fiyat platform incelemesine düşerse başarılı eşitleme olarak işaretlenmez; yeni stok işlerinin uzun süre fiyat onayı arkasında kilitlenmesi önlenir. Karışık kalem statüsü veya toplam farkı bulunan siparişler uzlaştırma durumunda tutulur. Kategori/marka/özellik kimlikleri önizlemede sağlayıcıdan doğrulanır.

## ToptanTR

- Resmî belge: <https://sapi.toptantr.com/sapi/docs>
- OpenAPI: <https://sapi.toptantr.com/sapi/docs/real-swagger.json>
- Sözleşme sürümü: **v4.12**. Belgede 25.07.2026, 05.08.2026 ve 18.09.2026 sürüm notları bulunuyor.
- Ortamlar: canlı `https://sapi.toptantr.com`, test `https://test.toptantr.com`.
- Token: `POST /sapi/v1/token`; JSON kökünde `username/password`, yanıt `access_token/expires_at_utc`. Diğer servisler Bearer kullanır.
- Ürün/sipariş okuma için gövdeli GET yerine resmî POST alternatifleri `/sapi/v1/products/search` (`productSearch`) ve `/sapi/v1/orders/search` (`orderSearch`) kullanılır.
- Stok/fiyat, ürün kartına değil kombinasyon ID'sine `/sapi/v1/combinations` ile yazılır. Gövde `product.combinations` şeklindedir. Paket toplam fiyatı `sellingPrice`, tek ürün fiyatı `unitPrice`; birlikte gönderilmez.
- Kombinasyondaki `barcode` satıcı SKU'su, `gtin` global barkoddur. Siparişte `quantity` varyasyon adedidir; paket içi adetle ikinci kez çarpılmaz.
- Batch sonuçları `/sapi/v1/jobs?batchRequestId=...` ile okunur. Her satırın `success` değeri ve son katalog değerleri kontrol edilir.
- Sipariş onayı `/sapi/v1/orders/{id}/approve`.
- Fatura bağlantısı `/sapi/v1/shortInvoceLink`; kök nesne özellikle `orderInvoce` olarak yazılır. Numara, bağlantı ve tarih birlikte zorunludur.

### Sözleşme ayrıntıları ve kabul gerektirenler

- Yetki hatası 401, bazı iş kuralı hataları ise **HTTP 200 + success:false** döner. HTTP 200 tek başına başarı değildir.
- Belgede bazı istek/yanıt şeması sapmaları açıkça belirtilmiş. Örneğin fatura servisi gerçekte `success/msg` döndürür.
- Genel açıklama ve örnekler 0 tabanlı, bazı alan açıklamaları 1 tabanlı sayfalama gösteriyor. Adaptör yanıtın sayfa bilgisini izler; gerçek hesapta tüm sayfaların kabulü gereklidir.
- Yalnız “Seçenekler” eksenini kullanan Adet/Paket/Koli kombinasyonlarında stok ortaktır. Bağımsız yerel varyant stoklarını bu gruba yazmak engellenir; ortak paket bileşen modeli henüz tamamlanmadı.
- Yeni ürünün tüm kombinasyonlarını tek üst ürün altında yayınlama, paket/etiket/bildirim akışları sonraki tamamlanacak işler arasındadır.

## Araştırma notu

Genel arama entegrasyonu sonuç döndürmediği için resmî sayfalar ve alternatif arama üzerinden araştırma sürdürüldü. `www.toptantr.com/robots.txt` içindeki `/sapi/docs` ipucu, satıcı API alt alanıyla birlikte doğrulandı. `www.toptantr.com/sapi/docs` ve yalnız `sapi.toptantr.com/` dokümanı göstermiyordu; doğru adres yukarıdaki alt alan + yol birleşimidir. Pazarama belgeleri JavaScript ile yüklendiği için tarayıcıdaki gerçek doküman sayfası incelendi.
