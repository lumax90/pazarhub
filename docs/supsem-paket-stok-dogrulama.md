# Paket, stok ve tanımlamalar — Supsem doğrulaması

Tarih: 23 Ekim 2026.

## Kaynaklar ve incelemenin sınırı

- Canlı `/dashboard/products/new/bundle` sihirbazında kategori, içerik ve paket bilgileri adımları açıldı. Bir varyantın miktarı taslakta ikiye çıkarılarak son adıma geçildi; kayıt oluşturulmadı.
- Canlı kategori, varyant, renk, depo, tedarikçi ve teknik özellik sayfaları ile boş oluşturma pencereleri okundu. Stok durumu listesinin kolonları ve gezinme bağlantıları kontrol edildi. Gerçek stok, tanım, ürün, sipariş veya fiyat değiştirilmedi.
- Stok giriş/çıkış sebepleri ve teknik özellik silmenin ürünlere etkisi resmî rehberden doğrulandı; canlı hesaptaki hareketler üzerinde denenmedi.
- Supsem ekran görüntüsü aracındaki önceki kısıt sürüyor. Canlı inceleme DOM/metin üzerinden yapıldı; aşağıdaki resmî rehberlerin yayımladığı görseller de referanstır. Bütün hata/yetki/sağlayıcı durumlarının görsel kabulü tamamlanmış değildir.

Resmî kaynaklar:

1. https://supsem.com/yardim/paket-urun-olusturma-ve-siparis-icerigini-gorme
2. https://supsem.com/yardim/stok-durumu-ve-hareketleri-nasil-takip-edilir
3. https://supsem.com/yardim/urun-kategorileri-nasil-tanimlanir
4. https://supsem.com/yardim/marka-renk-ve-varyant-tanimlari-nasil-yapilir
5. https://supsem.com/yardim/sube-ve-tedarikci-tanimlari-nasil-yapilir
6. https://supsem.com/yardim/teknik-ozellikler-nasil-tanimlanir

## Doğrulanan iş modeli

| Alan | Supsem davranışı | Uygulanan karşılık |
|---|---|---|
| Paket oluşturma | Ürünler → Paket oluştur; kategori → içerik → paket bilgileri | `/products/new/bundle`; mevcut fiziksel varyant, bileşen adedi, ürün/fatura/ölçü bilgileri ve görseller |
| Paket fiyatı | Ürün fiyatlarıyla eşle veya fiyatı sabit tut; bağlı fiyatta indirim | Bileşen satış toplamına indirim, kuruşta yuvarlama; sabit fiyat ayrı tutulur. Alış maliyeti bileşenlerden hesaplanır |
| Paket stoğu | İçindeki ürünlerin stoklarından hesaplanan satılabilir miktar | Depo başına en dar bileşen stoğu; fiziksel ürün ve diğer paketlerle ortak rezervasyon/tüketim |
| Sipariş içeriği | Paketteki adet ve siparişte gereken toplam; geçmişte anlık kayıt yoksa “Güncel paket içeriği” | Yeni sipariş/POS kaleminde bileşen kimliği, adet, ad, SKU, maliyet ve KDV dondurulur. Eski kayıtta güncel içerik yalnız görüntüleme içindir |
| Açıklama | “Paket içeriğini açıklamaya ekle” tabloyu kaydetmede yeniler | İşaretli stok kodu/ürün/adet tablosu her paket kaydında yenilenir; sipariş anlık görüntüsü bundan bağımsızdır |
| Tanımlamalar | Ürün Kategorileri, Varyantlar, Renkler, Depolar, Tedarikçiler, Markalar, Teknik Özellikler, Eşleştirmeler | Aynı alt menüler ve ayrı sayfa adresleri; mevcut mağaza kategori eşlemesine giriş |
| Kategori ağacı | Üst kategori, sıra, aktiflik; alt kategorilerle taşıma; pasifte alt dalları kapatma | Sürükleme, üst kategori düzenleme ve sürüm kontrollü sıralama. Ürün kategori kimlikleri, mağaza kategori eşlemeleri ve marj kapsamları birlikte korunur |
| Renk/varyant | Renk sistem varyantı; renkler ayrı yönetilir; diğer tiplerin seçenekleri | Düz/degrade renk, varyant tipi/değeri, yeni seçimde aktiflik kontrolü; ürün formunda ortak tanımdan seçim |
| Teknik özellik | Çoklu değer; değer ekleme, adlandırma, A–Z sırası; kullanım sayısıyla silme | Bir üründe birden çok değer; ad değişikliğini bağlı kartlara yansıtma; silinen değer/özelliği ürünlerden atomik kaldırma |
| Depo/tedarikçi | Depo kodu/konumu; tedarikçi iletişim/vergi/not alanları | Kalıcı tanımlar; kullanılan depo ve fiziksel stok kayıtları korunur |
| Stok sayfaları | Stok durumu, Hareketler, Transferler, Sayımlar | `/inventory/:view`, aynı perakende alt yolları; depo filtresi, giriş/çıkış, tarih/tür filtreleri, bağlı transfer hareketleri |

## Stok ve tarihçe kuralları

- Paket için ayrı açılış bakiyesi tutulmaz. Sayım, satın alma, transfer veya elle stok hareketi fiziksel bileşende yapılır.
- Bir depodaki paket adedi `min(floor(bileşenin kullanılabilir adedi / paketteki adedi))` ile hesaplanır. Farklı depolardaki parçalar kendiliğinden aynı pakette birleştirilmez.
- Aynı sipariş/sepet içinde fiziksel varyant, paket ve başka paket o varyantı kullanıyorsa ihtiyaçlar önce birleştirilir. Onay ve iade aynı firma veritabanı işlemi içinde çalışır.
- Ürün paket içeriği değişse bile mevcut siparişin onay/iptal/iadesi kayıtlı bileşenleri kullanır. İçerik anlık kaydı eksik olan işlenebilir siparişte otomatik stok yazımı reddedilir.
- Siparişin stok çıkışı henüz uygulanmamışsa iade işlemi bileşen stoğunu artıramaz. Kısmi iadelerin maliyet/KDV etkisi kümülatif hesaplanır; tam iade tamamlandığında yuvarlama artığı kalmaz.
- Pazaryerinden geçmiş paket siparişi alınması stok hareketi oluşturmaz; o tarihe ait içerik/maliyet bilinmiyorsa güncel maliyet tarihsel maliyet gibi işaretlenmez.
- Yeni hareketlerde işlem sonrası depo bakiyesi saklanır; kullanıcı tarafından oluşturulan API komutlarında yazar sunucu oturumundan gelir. Eski kayıtlarda bilinmeyen kullanıcı/bakiye `—` gösterilir.
- Fiyat ve stok ilanlara ortak hesaplayıcıdan gider. Mağazaya özel fiyatın önceliği korunur; paket değişikliği mevcut fiyat/stok uzlaştırma kuyruğunu kullanır.
- Katalog tanımları firma kapsamındadır. Şema 8 eski ürün adlarından tanımları oluşturur; şema 9 daha önce tanımlanmış kataloglarda eksik kimlik bağlarını tamamlar. Kaynakta bulunmayan kategori ağacı veya renk kodu tahmin edilmez.

## Açık farklar

- KDV dahil/hariç giriş esası, döviz ve ortak e-ticaret stok ayarları; eksi stok seçeneği, depo bazlı kritik eşikler ve diğer toplu stok işlemleri henüz tamamlanmadı.
- Renk bazlı ürün görsel grupları, marka logoları ve tanımlama listelerindeki olası tekrarları birleştirme kapsamı henüz yok.
- Eşleştirmeler sayfası mevcut mağaza kategori/ortak özellik eşlemesini açar. Ayrı marka, renk, varyant değeri ve teknik değer eşleme sekmeleri sağlayıcı sözleşmeleriyle tamamlanacak.
- Önceki notlardaki “kategoriye bağlı varyant/teknik özellik şablonu” bu turda bağımsız bir Supsem işlevi olarak doğrulanmadı. Ortak tanımlar ve pazaryeri kategori varsayılanlarıyla aynı iş sayılmamalı; ayrıca doğrulanmadan yeni şablon sistemi eklenmez.
- ToptanTR Adet/Paket/Koli ortak stok sözleşmesi, bu yerel paket tarifinden ayrı bir sağlayıcı uyarlamasıdır. `SHARED_PACKAGE_STOCK` engeli henüz kaldırılmadı.
- Uygulamanın teknik sınırları: paket başına 50 fiziksel varyant, bileşen başına 1–10.000 adet, bir paket için en az iki adet. Kategori yolları 300 karakter; döngü/derinlik kontrolü var. Bunlar Supsem'in ölçülmüş sunucu limitleri olduğu iddiası değildir.
- Gerçek pazaryeri, kargo ve Paraşüt hesaplarıyla kabul ve Coolify staging hâlâ gerekli.

## Doğrulama kayıtları

Alan/sunucu regresyonları `tests/bundles.test.ts`, `tests/definitions.test.ts`, `tests/server.test.ts`; tarayıcı akışı `e2e/catalog.spec.ts` içindedir. Son tamamlanmış test ve derleme sonuçları [yayına hazırlık](yayin-hazirligi.md) belgesinde tutulur.
