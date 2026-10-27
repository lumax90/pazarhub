# Pazaryeri paketleri, uzlaştırma ve mevcut içerik

24 Ekim 2026. Bu belge kodlanan sözleşmeleri ve yerel kabul sonuçlarını kaydeder. Gerçek mağaza/taşıyıcı/Paraşüt kabulü ve müşteri geçişi ayrıca açıktır.

## Paket işlemleri

Sipariş detayındaki **Pazaryeri paketleri** kartı güncel sağlayıcı verisini okur. Seçilen kalemler, paket kimliği, yerel sipariş içeriği ve sağlayıcı anlık görüntüsü kayıtlı bir planla doğrulanır. Arada değişiklik varsa yazma başlamaz. Aynı siparişte devam eden/belirsiz iş varken yeni paket işlemi açılmaz. Kaybolan yazma yanıtı **Sonucu doğrula** ile okunur; paket yeniden oluşturulmaz.

| Sağlayıcı | Uygulanan akış | Sözleşme sınırı |
|---|---|---|
| Trendyol | Picking, ortak etiket talebi/alımı, kendi kargo takip bağlantısı, tedarik edememe | Ortak etiket TEX/Aras için sağlayıcının desteklediği modelde; fiziksel gönderide alternatif teslimat linki kullanılır. |
| Hepsiburada | Birlikte paketlenebilir kalemleri doğrulama, paket oluşturma, ZPL, kendi kargo bildirimi, açık tam kalem iptali | Etiket desteği taşıyıcıya bağlı; iptal işleminde tek tam kalem seçilir. |
| n11 | REST Picking onayı, SOAP iptal nedenleri ve onaylı kalemin iptali, tekrar okuma | Güncel REST UpdateOrder yalnız Picking destekliyor. Doğrudan kargo/etiket işlemi varsayılmadı. |
| Amazon TR | Merchant-fulfilled paket kalemleri ve takip bildirimi | Okuma Orders 2026-01-01; yazma resmî v0 confirmShipment. Pozitif sayısal paket referansı sabittir; FBA kapsam dışıdır. |
| Çiçeksepeti | Model 1 kargo kodu, model 2 kendi kargo takip/durum bildirimi | Gerçek `cargoModelType` ile mağaza tercihi eşleşmeli. Sipariş sorgusu aynı içerikle dakikada bir yapılır. |
| PttAVM | Pazaryeri deposu, tüm siparişe barkod oluşturma, takip kimliğiyle tüm barkodları doğrulama, ZPL | Fiziksel gönderilerde dijital ürünün teslim edildi servisi kullanılmaz. |
| Pazarama | Hazırlanıyor (12), paket oluşturma, güncel paket/history, tedarik edilemedi (13), kendi kargo (5) | Paketleme için satıcının GUID kimliği gerekir. Paket GET yolu Ekim 2026 resmî belgesindeki `shipment-packages/orderId=...` biçimindedir; gerçek hesap kabulü açıktır. |
| ToptanTR | Anlaşmalı/kendi kargo seçimi, çok kolili sevkiyat, etiket, sevk bildirimi, sevk edilmemiş siparişin tamamının iptali | Sipariş miktarı varyasyon adedidir; `itemPerPackage` ile tekrar çarpılmaz. Koli başına ölçüler kullanıcıdan alınır. |

Etiketler veritabanında kalıcı saklanır. Pazaryeri kargo listesi birden fazla paketi ayrı satırlarda gösterir. Gönderi oluşturmanın kabul edilmesi ile sağlayıcı kaydının doğrulanması ayrı durumlardır.

### Kaynaklar

- Trendyol: `reference/updatepackagestatus.md`, `cancelorderpackageitem.md`, `processalternativedelivery.md`, `createcommonlabel.md`, `getcommonlabel.md`, `getshipmentpackages.md` — https://developers.trendyol.com/
- Hepsiburada: https://developers.hepsiburada.com/api/v1/public/docs/hepsiburada/siparis-olusturma-entegrasyonu/v1.0/openapi ve aynı modülün `siparis-entegrasyonu-onemli-bilgiler` rehberi.
- n11: https://developer.n11.com/documentation/n11-siparis-entegrasyonu/siparis-kalemlerini-guncelleme-servisi/ ; https://developer.n11.com/documentation/iade-entgrasyonu/parcali-iptal-talebi/ ; https://api.n11.com/ws/ClaimCancelService.wsdl
- Amazon: `amzn/selling-partner-api-models/main/models/orders-api-model/orders_2026-01-01.json` ve `ordersV0.json`.
- Çiçeksepeti: https://ciceksepeti.dev/siparis/sparis-kargo-srecleri/cicek-sepeti-kargo-entegrasyonu ve `tedarikcinin-kendi-kargo-entegrasyonu`.
- PttAVM: https://developers.pttavm.com/tr/kargo-entegrasyonu/ altındaki depo, barkod oluşturma, barkod kontrol ve etiket belgeleri.
- Pazarama CMS: `kargo-takip-durumu-bildirme`, `siparise-ait-durum-guncelleme`, `paket-yapisi`, `itemlari-tek-seferde-guncelleme`; `X-Platform: 1`, `x-channelcode: 22`, `x-lang-code: tr` ile `api/content/getBySlug/`.
- ToptanTR: https://sapi.toptantr.com/sapi/docs/real-swagger.json v4.12.

## Fatura / taşıyıcı uzlaştırması

- Fatura aktarımında sipariş ve alıcı anlık görüntüsü iş payload'ına kaydedilir. Hazırlık sırasında kaynak değişirse yazma durur.
- Paraşüt kaydı açıklamadaki yerel referans, sipariş numarası, tarih, müşteri, VKN/TCKN, para birimi, kalem ürünleri, adet/KDV ve tutarlarla doğrulanır. İsteğe bağlı sağlayıcı fatura kimliği yanlış belge bağlanmasına izin vermez.
- Yanıtı kaybolmuş müşteri/ürün hazırlığı, o hazırlık kaydı bulunduğunda kaldığı adımdan devam eder. Fatura/resmileştirme tekrar yazılmaz. E-belge ve PDF doğrulandığında belirsiz kaynak iş tamamlanır.
- Yurtiçi, Aras ve PTT için kayıtlı referans/tahsisli barkodla okuma ve etiket sorgusu eklendi. İptalin doğrulanamadığı durum, iptal edilmiş kabul edilmez. DHL/MNG referans sorgusu için resmî ApiZone sözleşmesi hâlâ erişim engellidir.

Paraşüt kaynağı: https://apidocs.parasut.com/swagger.json ; `sales_invoices` tarih filtresi, `contact,details,details.product,active_e_document` ilişkileri ve `trackable_jobs`. Güncel resmî para birimi listesi TRL/USD/EUR/GBP; `exchange_rate` alanı gönderilir ve okuma sonucunda kayıtlı kurla karşılaştırılır.

## Değişen sipariş kalemleri

**Kalemleri uzlaştır** güncel dış kaydı yerel varyantlarla eşleştirir, tutar ve depo etkisini önizler. Onaylanan plan firma revizyonu ve sağlayıcı içerik özetiyle korunur; uygulama tek seferliktir. Önceki satırlar ve tutar işlem geçmişine saklanır. Paket stok iadesinde siparişe dondurulmuş reçete kullanılır. Stok çıkışı uygulanmamış tarihsel kayıttan stok üretilmez. Kullanıcı azaltılan miktarın depoya dönüp dönmediğini seçer.

Paraşüt'e aktarılmış/resmî belgeyi etkileyen ekonomik değişiklikler ve daha önce iade kaydı olan siparişler otomatik yeniden yazılmaz; ilgili mali/iade düzeltmesinin önce uzlaştırılması gerekir. Aynı sağlayıcı kaydının sonraki eşitlemeleri, onaylanan stok farkını yeniden uygulamaz. Kısmi sevkiyat gibi ekonomik fark yaratmayan karışık durumlar da doğrulanabilir.

## Mevcut ilan içeriği

Alan seçimi → önizleme → kuyruk → alan onayı akışı eklendi. Stok/fiyat alanları içerik gövdesine eklenmez. Aynı uzak içerik kimliğini paylaşan ilanların eşzamanlı içerik işleri engellenir.

- **Trendyol:** V2 `content-bulk-update`; `contentId` ve ilgili SKU'lar onaylı katalogdan gelir. `update-audits` ile aynı batch'in TITLE/DESCRIPTION/MEDIA onayları doğrulanır; CDN'in görsel URL'sini değiştirmesi yanlış bir sonuca neden olmaz.
- **Hepsiburada:** ticket-api JSON dosyasıyla seçilen alanlar; NAME/DESCRIPTION/MEDIA alan sonuçları kontrol edilir. Görsel alanları sıra bazlı güncellenir; kısmi onay tam başarı sayılmaz.
- **n11:** ürün açıklaması. Resmî güncelleme sözleşmesinde desteklenmeyen katalog başlığı ve ürün görselleri gönderilmez.
- **Çiçeksepeti:** zorunlu güncelleme alanlarıyla birlikte mevcut operatorContacts, safetyInfo, özellik ve teslimat değerleri korunur. Bu alanların okunamadığı kayıt güncellenmez. Aynı ürün sorgusunun on dakikalık sınırı kuyruğa yansıtılır.
- **PttAVM:** üst ürünün tüm varyant kimlikleri gönderilir; miktar/fiyat farkı yazılmaz. Böylece içerik güncellemesi varyant silme veya stok sıfırlama isteğine dönüşmez.
- **ToptanTR:** mevcut üst ürünün koduyla kısmi içerik güncellemesi; kombinasyonlar tekrar oluşturulmaz.
- Amazon mevcut-ASIN teklifleri ve Pazarama için genel katalog adı/görseli güncelleme sözleşmesi varsayılmadı; desteklenmeyen içerik düğmesi gösterilmez.

İçerik kaynakları: Trendyol `updatecontentbulk.md`, `getupdateaudits.md`, `filterapprovedproducts.md`; Hepsiburada `urun-guncelleme-entegrasyonu/v1.0/openapi`; n11 `urun-bilgisi-guncelleme`; Çiçeksepeti `urun/urunlerin-guncellenmesi`; PttAVM `ueruen-ekleme-guncelleme`; ToptanTR v4.12.

## Tamamlanan sipariş / stok ayrıntıları

- E-ticarette tüm etkin depolar veya seçili depolar kullanılabilir; mağaza özel depo seçimi önceliklidir. Yeni siparişlerin depo dağılımı rezervasyonda kaydedilir ve onayda tekrar stok kontrolünden geçer. Paket bileşenleri aynı depodan karşılanır. İptal ve kısmi iadeler, siparişin dondurulmuş kalem/depo dağılımına döner.
- Manuel siparişte TRY/USD/EUR/GBP ve KDV dahil/hariç giriş bulunur. İndirim ve satır yuvarlaması seçilen para biriminde yapılır; özgün tutar, TCMB kur değeri/tarihi ve TRY defter karşılığı saklanır. Eski kurla gelen istek reddedilir. Sonradan kur değişmesi satış, kasa ve cari hareketi yeniden değerlemez.
- Sipariş çıktısı elle yazdırıldı olarak işaretlenebilir; bu durum toplu işleme ve filtreye bağlıdır. Kaydedilen çıktı içeriği değişirse eski yazdırıldı işareti güncel çıktı için geçerli sayılmaz. Tarayıcının fiziksel yazdırma başarısı varsayılmaz.
- Toplu fatura taslağı, hazırlık işaretleme/kaldırma ve yazdırıldı işaretleme/kaldırma eklendi. Her kaydın başarısı veya atlanma sebebi gösterilir.
- Ürün görsellerine alternatif metin ve kalıcı renk değeri ilişkisi eklenir. Varyantın kendi görselleri ortak görsellerden önce gelir. Başka rengin fotoğrafı yanlışlıkla seçilmez. Üst ürün görsellerini ortak isteyen PttAVM/ToptanTR grupları ortak ürün görselleriyle gönderilir.
- İşleyici her sağlayıcı çağrısından önce kendi iş sahipliğini ve bağlantı sürümünü kontrol eder. Stok kaynağı, grup üyeleri, yayın/fatura/sipariş anlık görüntüsü çağrılar arasında değişirse eski planla sonraki yazma başlatılmaz.

## Soru, iade ve finans kapsamı

- Soru/yanıt: Trendyol'a ek olarak n11 SOAP, Çiçeksepeti sellerquestions ve Pazarama QuestionAnswer uçları. Yanıt metni ve sağlayıcı onay durumu birlikte doğrulanır; moderasyon bekleyen yanıt bitmiş sayılmaz.
- İade: Trendyol seçili birimleri; Çiçeksepeti ve Pazarama talebin tamamı; n11 ReturnService ve Hepsiburada normal Return talepleri. Platform kararı yerel stok/kasa iadesi yaratmaz.
- Ret/inceleme: Trendyol neden listesi ve multipart kanıt, Pazarama neden/inceleme türü ve gerekli görseller, n11 sağlayıcı nedenleri ve gün sayılı erteleme. n11 ret için kampanyalı geri gönderim; “ürün ulaşmadı” nedeninde belgede belirtilen boş gönderim tipi kullanılır. Hepsiburada normal iade retleri ihtilaflı/değerlendirme durumuyla izlenir; eksik fatura, yeni ürün ve ön onay talepleri normal iade gibi otomatik onaylanmaz.
- Kanıt dosyaları firma ve talep ilişkisiyle saklanır. Kullanılan dosya işlem geçmişinde korunur; genel `/media` adresinden açılamaz.
- Hepsiburada kayıt bazlı muhasebe servisi 1/10.000 TRY kesinliğinde ekstreye bağlandı. `Payment` satış tutarıdır; banka ödeme emri olarak yorumlanmaz. `isIncome` yönü belirler. Ayrı bir ödeme emri/kalem ilişkisi sunmayan kayıttan tarih bazlı sahte banka mutabakatı üretilmez.
- n11 teslimat şablonları `ShipmentService.wsdl` üzerinden alınır ve yayın önizlemesinde mağazanın gerçek şablon adı doğrulanır.

Ek kaynaklar: n11 `ReturnService.wsdl`, `ShipmentService.wsdl` ve güncel `iade-talepleri-servisi` rehberi; Hepsiburada `muhasebe-entegrasyonu/v1.0/openapi`, `talep-listeleme/v1.0/openapi`, `talep-onemli-bilgiler-2`; Pazarama soru/yanıt, iade ve ret/inceleme CMS belgeleri; Çiçeksepeti soru/yanıt ve iade rehberleri. PttAVM ana yetkilendirme belgesi otomatik token edinme ayrıntısını yetkili hesaplara verilen `API key documentation.docx` belgesine bırakıyor; mevcut public belgede token yenileme ucu yok.

## Yerel kabul

- Genel paket, belirsiz yanıt, kalem uzlaştırma, fatura/taşıyıcı, içerik, döviz/çok depo ve temsili geçiş regresyonları dahil **215 test / 30 dosya** geçti.
- **19 tarayıcı akışı geçti:** PttAVM grup yayını, fatura uzlaştırması, mevcut ilan içeriği, kanıtlı ret ve paket → etiket → kısmi iptal → stok uzlaştırma dahil. Döviz/depo/görsel/yazdırma akışı ve hazır dövizli siparişin mobil görünümü ayrıca doğrulandı.
- 390 px sipariş/paket ekranı gözden geçirildi; tablolar kendi alanında kayıyor. Kaynaklar ve kalan genel kapsam `yayin-hazirligi.md` içinde izlenir.
- Temsili şirket geçişi kapsamı: [Supsem geçiş provası](supsem-gecis-provasi.md).
