# Fiyat, eşleme ve e-ticaret ayarları

Tarih: 24 Ekim 2026. Bu çalışma ana işlevleri tamamlama görevinin parçasıdır; genel müşteri geçişi onayı değildir.

## Supsem doğrulaması

Canlı `/dashboard/definitions/margins` ekranında altı kapsam ve şablon pencereleri okundu. Kaydedilmeyen kural alanlarında 100 TL taban, 20 TL kargo, 10 TL sabit gider, %50 artış, %20 içeriden komisyon örneği **243,75 TL** gösterdi. Gerçek kurallar, fiyatlar veya bağlantı tercihleri kaydedilmedi.

- Öncelik: ürün → desi → fiyat aralığı → marka → kategori → toplu.
- Fiyat ve desi aralıkları alt/üst sınır dahil.
- Yüzde artış/azalış, tutar ekleme/çıkarma, doğrudan sabit fiyat ve marjdan hariç kapsam.
- Sabit fiyat, maliyet/komisyon/yuvarlama aşamalarını atlar.
- Formüller: `(Taban + Kargo + Sabit gider) × Marj × Komisyon` ve `(Taban × Marj × Komisyon) + Kargo + Sabit gider`.
- Komisyon içeriden düşülebilir veya üzerine eklenebilir. Yuvarlama: kuruşlu, yukarı ,99/,95, yukarı tam sayı, en yakın tam sayı.
- Liste fiyatı: satışa eşit, yüzdeli artış veya mevcut değeri koruma.
- `/dashboard/ecommerce-settings`: ürün dövizi, KDV dahil/hariç giriş, TCMB kur türleri, negatif stok, stok eşikleri ve sipariş tarih/termin varsayılanları okundu.

Eşleme rehberi: https://supsem.com/yardim/pazaryeri-kategori-ve-marka-eslestirmesi-nasil-yapilir

Rehber, kategori/marka/renk/varyant değerlerini **pazaryeri başına** paylaşır; kategori özellik şablonları boş ürün alanlarına varsayılandır, ürün/ilan değeri önceliklidir. Teknik değerler önceki canlı eşleme ekranında da gözlenmiştir.

## Uygulanan işlevler

- `src/domain/margins.ts`: tek fiyat motoru, tam sayı/rasyonel para hesabı, altı kapsam, kapsam dışlama, sabit fiyat, formül/komisyon/yuvarlama ve liste fiyatı.
- Önceki marj kayıtları yeni şablon açıkça kaydedilene kadar eski hesap sırasını korur. Çakışan etkin bantlar ve eski sürümle kayıt reddedilir.
- Otomatik fiyat kapatılırken son hesaplanan fiyat korunur. **Şimdi uygula** açık kullanıcı işlemiyle yeniden hesaplar. Elle yazılan fiyat önceliklidir.
- Liste fiyatı Trendyol, n11 ve Pazarama isteklerine taşınır; önizleme ve tekrar deneme planlarına dahil edilir. Mevcut liste fiyatını koruma tercihi, fiyat bilinmiyorsa mevcut ilanı sıfırlamak yerine doğrulama ister.
- Kategori varsayılanları sağlayıcı genelinde paylaşılabilir; önceki mağazaya özel eşlemeler öncelikli kalır. Marka, renk, varyant ve teknik değerler kategori şeması ve sağlayıcının gerçek değer listesiyle doğrulanır.
- `src/domain/money.ts`, `server/exchange-rates.ts`: TCMB kurları, sekiz ondalıklı tam sayı kur; JPY gibi çoklu birimle verilen kurların birim başına normalizasyonu. Tatilde son bilinen yayımlanmış kur korunur.
- Katalog fiyatları ürünün para biriminde, KDV dahil küçük birimde saklanır. Sipariş/POS/marj/pazaryeri için TRY hesaplanır. Yeni satışın maliyet ve kur bilgisi dondurulur; geçmiş hareketler kur değişiminde yeniden yazılmaz.
- Ürün fiyat formları KDV hariç giriş seçimini destekler; iç kayda KDV dahil tutar geçer. Döviz/KDV değişikliği fiyat kartından önce kaydedilir. CSV/XML için para birimi sütunu ve dövizli güncellemede açık para birimi kontrolü eklendi.
- Negatif stok açıkken satış/transfer/çıkış hesapları buna uyar; pazaryerine miktar en az sıfır gider. Depo kritik eşikleri, ortak düşük stok hesabına bağlandı.
- Sipariş PDF/görsel ekleri, firma oturumuyla indirilen özel dosyalardır. Public medya adresinden erişilemez; ek ve dosya silme aynı işlemde yapılır.

## Hepsiburada yeni ürün yayınlama

Güncel resmî kaynaklar, normal web isteği 403 verdiğinde portalın tarayıcıdaki herkese açık doküman uçlarından okundu:

- https://developers.hepsiburada.com/api/v1/public/nav-tree?company=hepsiburada&locale=tr
- https://developers.hepsiburada.com/api/v1/public/docs/hepsiburada/katalog-urun-entegrasyonu/v1.0/openapi
- https://developers.hepsiburada.com/api/v1/public/docs/hepsiburada/katalog-urun-entegrasyonu/guides/katalog-onemli-bilgiler?locale=tr

`server/publishing/hepsiburada.ts` aktif uç kategorileri, metin kimlikli özellikleri, sayfalı enum değerlerini, JSON dosyasını multipart yüklemeyi ve takip sonucunu uygular. SKU büyük harf/boşluksuz; fiyat virgüllü iki ondalık; varyantlar ortak `VaryantGroupID` kullanır.

Yükleme öncesi var olan SKU kontrol edilir. Sonuçta işlem kabulü ile satışa açık ilan ayrılır; katalog barkodu, satıcı SKU'su ve Hepsiburada SKU'su birlikte doğrulanır. Kaybolan yazma yanıtı otomatik yeniden oluşturulmaz, okuma ile kontrol edilir. Oluşan HB SKU'su stok/fiyat eşlemesine aktarılır.

## Araştırılan fakat henüz uygulanmayan sağlayıcı ayrıntıları

- PttAVM `POST /api/v1/products/upsert`, gönderilen varyant dizisini son durum kabul ediyor; eksik varyantlar silinebilir. Tam üst ürün/varyant planı, kimlik normalizasyonu ve mevcut katalog korunması birlikte tamamlanmalı.
- PttAVM kaynakları: `/tr/katalog-entegrasyonu/ueruen-ekleme-guncelleme`, `/kategori-bilgisi`, `/ueruen-guencelleme-kontrol`, `/barkod-kontrol` altında. Yazma sözleşmesi SKU anlamındaki `barcode` ile EAN'ı ayırıyor; okuma örneklerindeki bazı varyant alanları hâlâ `?` açıklamalı.
- ToptanTR v4.12 ortak stok akışı uygulandı: yalnız “Seçenekler” tipli ürünün tüm varyasyonları aynı fiziksel stok kaynağına, gerçek `itemPerPackage` oranlarıyla bağlanmış olmalı. Paketler baz varyasyonun tam katı olmalı; baz stok yazımı yalnız en küçük varyasyona gider. Kapatılacak paketlerin fiyatı önce sıfırlanır; diğer paketlerin fiziksel stoğu korunur. Ardından baz stok ve türetilen bütün miktarlar katalogdan doğrulanır. Eski kaynak miktarı/eşleme/fiyat planları reddedilir.
- Ortak ToptanTR grubunda stok tamponu henüz **0** olmalı; farklı paket birimlerinde bağımsız tampon semantiği ayrıca doğrulanmadan uygulanmaz. Eksik/bağımsız ürün eşlemelerinde `SHARED_PACKAGE_STOCK`, sıfır olmayan tamponda `SHARED_PACKAGE_BUFFER` kontrolü sürer.
- Stok/fiyat ayrımı da doğrulandı: `PUT /sapi/v1/combinations/stock` yalnız `quantity`, `PUT /sapi/v1/combinations/price` yalnız fiyat alanları kabul eder. İki uç da `product.combinations` sarmalı kullanır ve `batchRequestId` döndürür; satır sonucu `/jobs?batchRequestId=...` ile izlenir. Stok/fiyat alanları yanlış uçta birlikte gönderilirse satır başarısız olur.
- Aynı Swagger'ın `POST /sapi/v1/products` işlemi yeni katalog ürünü değil, **kütüphaneden ürün ekleme** işlemidir. Yeni katalog ürünü için `/products/new` kullanılmalıdır.

### ToptanTR yeni üst ürün ve varyantlar

`/products/new` akışı artık grup önizlemesiyle çalışır. Aynı mağaza ve ortak model kodundaki hazırlıkların tamamı tek üst üründe birleştirilir. Her üye ayrı kategori/özellik/fiyat doğrulamasından geçer; grup dışı veya tek üyelik iç önizleme doğrudan gönderilemez. Gönderim bütün üyeleri aynı iş kimliğiyle kilitler. Bir üyede kaynak değişirse tüm grup önizlemesi geçersiz olur.

Normal varyantlar ve aynı fiziksel üründen tüketilen Adet/Paket üyeleri doğrulandı. Ortak stokta bileşen miktarı `itemPerPackage` oranıyla eşleşmeli. Üyeler aynı üst ürün başlığı, açıklaması, kategorisi, markası ve görsellerini kullanır. Tek yanıt kaybolduğunda üyelerin tamamı belirsiz kalır; tüm SKU/GTIN kimlikleri bulunmadan kaynak iş tamamlandı sayılmaz. İşleyici kesilmesi de grubun bütün üyelerine yansır.

API/işleyici regresyonlarında iki varyantın tek istekte gönderilmesi, eski grup reddi, tek üye gönderiminin engellenmesi, kısmi katalog yanıtı, kaybolan yanıt, her üyenin ayrı uzak kimliği ve sonraki stok/fiyat takibi doğrulandı. Gerçek hesap kabulü açık.

## Açık ana işler

PttAVM tam varyasyonlu yeni yayın; mevcut ilan içeriği güncelleme; sağlayıcı paket/etiket/bildirim ve iptal işlemleri; belirsiz fatura/kargo sonucunun operatörle uzlaştırılması; desteklenen sağlayıcılarda soru/iade/hakediş genişletmesi. Manuel siparişin kendi döviz cinsi, çok depodan otomatik sipariş dağıtımı ve yazdırıldı takibi de ayrıntı kabulü bekliyor. ToptanTR uygun ortak stok ve yeni üst ürün grupları kodlandı; sıfır olmayan ortak stok tamponu ve gerçek hesap kabulü açık.

Canlı hesap, firma veri aktarımı, Coolify/PostgreSQL/SMTP ve yedek kabulü ayrıca açık. Tam ana kapsam ve müşteri geçişi henüz tamamlandı olarak işaretlenmez.
