# Yayına hazırlık

Hedef: Coolify üzerinde React/Vite arayüzü, Node.js API, PostgreSQL ve ayrı entegrasyon işleyicisi.

## Onaylanan kapsam

- Pazaryerleri: Trendyol, Hepsiburada, n11, Amazon Türkiye, Çiçeksepeti, Pazarama, PttAVM, ToptanTR.
- Fatura: Paraşüt; taslak, resmileştirme ve pazaryerine belge iletimi ayrı aşamalar.
- Kargo: pazaryeri anlaşması ve işletmenin Yurtiçi, DHL eCommerce/MNG, Aras, PTT hesapları.
- Tanıdık Supsem yapısı: ürün → varyant → mağaza ilanı; ortak stok, müşteri, kasa ve belge.

## İncelemede bulunan farklar

| Alan | Önceki temel | Bu iterasyondaki iş |
|---|---|---|
| Oturum / ekip | Tarayıcı demosu | Sunucu oturumu, rol, firma izolasyonu, davet |
| Veri | localStorage | PostgreSQL işlemleri, tekrar önleme, kullanıcıya özel görünüm |
| Entegrasyon | Örnek mağazalar | Şifreli anahtar, gerçek API adaptörü, kabiliyet ve bağlantı testi |
| Senkronizasyon | Yok | Kalıcı kuyruk, mağaza sırası, tekrar deneme, sonuç takibi |
| Ürün eşleme | Yalnız yerel ilanlar | Uzak katalog, barkod/SKU önerisi, içe alma ve kalem eşleme |
| Stok / perakende | Tek depo, satış | İade, sayım/transfer ve ortak defter akışlarını tamamlama |
| Muhasebe | Yerel fatura taslağı / kasa | Paraşüt, gider ve cari kayıtları |
| Sipariş | Yerel durum işlemleri | Platform durumu, adres / fiyat anlık görüntüsü, kargo ve fatura kuralları |
| İşlem merkezi | Yok | Kuyruk, hata, tekrar ve belirsiz sonuçların görünmesi |
| Yayın | Vite önizleme | Docker/Coolify kurulumu, sağlık kontrolleri, yedekleme/geri yükleme |

## 23 Ekim 2026 — uygulanan iterasyon

- Kalıcı veritabanı, oturum, üyelik/rol, davet, parola yenileme SMTP akışı ve işlem makbuzları eklendi.
- Şifreli bağlantılar, test/etkinleştirme ekranı, iş merkezi, kalıcı kuyruk ve kayıt sıralaması eklendi.
- Uzak ürün havuzu, yerel ürün oluşturma/eşleme ve sipariş kalem eşlemesi eklendi.
- Çoklu depo, transfer, stok sayımı, kısmi iade, indirim, bölünmüş/kısmi tahsilat ve veresiye eklendi.
- Gider/alış, ağırlıklı alış maliyeti, gider ödemesi, virman, cari fiş ve müşteri bakiyesi eklendi.
- Ürün görselleri, varyant ekleme, toplu düzenleme ve temel marj kuralları eklendi.
- Paraşüt taslağı/resmileştirme/PDF saklama ve kendi anlaşmalı kargo gönderi ekranları eklendi.
- Coolify için Docker Compose, sağlık kontrolü ve günlük veritabanı yedek paketi eklendi.
- Trendyol V2, n11, Çiçeksepeti için yeni ürün; Amazon Türkiye için mevcut ASIN'e teklif hazırlama ve gönderim eklendi.
- Mağazaya özel kategori eşlemeleri, ortak özellik varsayılanları, zorunlu/varyant özellikleri, marka araması ve taslak kaynak bilgileri eklendi.
- Sunucuda doğrulanmış 10 dakikalık yayın önizlemesi; kaynak stok/fiyat/özellik değişirse gönderimden önce geçersiz kılma eklendi.
- Parti/task kabulü ve gerçek ilan onayı ayrıldı. Belirsiz yayınlar barkod/SKU üzerinden okuma işlemiyle doğrulanabiliyor; yeni oluşturma isteği otomatik tekrarlanmıyor.
- Trendyol müşteri soruları, yanıt sonrası doğrulama, seçilen iade kalemlerinin onayı ve sağlayıcı sonucunu izleme eklendi.
- Trendyol finans kayıtları dört ondalıklı tam sayı olarak saklanıyor. Ödeme emri detay sayfaları birlikte alınabiliyor; komisyonu iki kere düşmeden net hakediş karşılaştırması, tahsilat eşleme ve eşlemeyi kaldırma eklendi.
- İşleyici, API komutları ve süre aşımı kurtarmasında firma → iş satırı kilit sırası tutarlı hale getirildi.
- Pazarama'nın Ekim 2026 katalog sözleşmesi ve ToptanTR v4.12 resmî belgesi bulundu; iki adaptör kullanıma açıldı. Kaynaklar ve sözleşme ayrıntıları [burada](pazarama-toptantr-kaynaklar.md).
- CSV/XML dosyasında alan eşleme, model → varyant gruplama, SKU üzerinden güncelleme, depo seçimi, önizleme ve tek seferlik atomik uygulama eklendi. Dosya başına en fazla 500 varyant; boş hücreler mevcut değerleri korur.
- Ürün oluşturma kategori → varyasyon → ürün bilgileri şeklinde tam sayfaya taşındı. Üç varyant tipi/500 kombinasyon, toplu fiyat/maliyet/açılış miktarı ve hedef depo seçimi eklendi.
- Ürün detayı dokuz sekmeye ayrıldı. Fatura adı, birim, tedarikçi, alt başlık, menşei, GTİP, ölçüler/desi, raf ve teknik özellikler kalıcıdır. Kart bazında sürüm kontrollü kayıt, stok bakiyesi kontrollü düzeltme ve yeni varyant açılış hareketleri eklendi.
- Ürün/varyant teknik değerleri ilan hazırlığında güncel sağlayıcı seçenekleriyle eşleştirilerek doldurulabiliyor. Mağaza değeri belirtilmediyse desi ve menşei ürün kartından alınıyor. Fatura adı/birim yeni satış kalemine dondurulup Paraşüt'e aktarılıyor.
- Ürün listesine sütun menüsü, görsel büyütme ve hızlı stok işlemi; perakendeye işlem kısayolları, günlük özet, ayrı menü ve alt sayfa adresleri eklendi.
- Supsem sipariş listesi/formu/detayı ve resmî rehberleri yeniden doğrulandı. Listeye tarih, kayıtlı firma filtreleri, kullanıcı sütun tercihleri, hazırlık/fatura alanları eklendi; oluşturma ve detay kartlı tam sayfaya taşındı.
- Manuel siparişte alıcı/fatura adresi, ön tahsilat/ödeme yöntemi, katalog/serbest hizmet satırı, yüzde/tutar indirimi ve müşteri/iç not eklendi. Serbest satır stoktan düşmez; fatura oluşturma sipariş stok düşümünü yinelemez.
- Hazırlık işaretleri ve notlar kalıcıdır. Hemen faturalama yetki/hesap kontrolüyle atomik kuyruğa alınır. Yerel kargo/takip bilgisi, stoka dönmeden iade, toplu onay/uygun iptal/KDV ve sipariş çıktısı eklendi. Kaynak/kabul sınırları [sipariş doğrulamasında](supsem-siparis-dogrulama.md).
- Statik uygulama dosyalarının API hız sınırını tüketmesi düzeltildi; statik dosya sunumu, API kotası ve giriş kotası ayrı regresyonla doğrulandı.
- Supsem'in üç adımlı paket sihirbazı doğrulandı ve `/products/new/bundle` eklendi. Bağlı/indirimli veya sabit fiyat; depo bazında fiziksel bileşenlerden ortak stok; sipariş ve perakendede dondurulmuş paket içeriği; bu içerikten iptal/kısmi iade uygulanıyor. Paket stoğu bağımsız sayım/alış/transferle çoğaltılamıyor.
- Tanımlamalar alt menüsü ve kategori, marka, tedarikçi, renk, varyant, teknik özellik, depo sayfaları eklendi. Ürün formları ortak tanımları seçiyor; kategori taşıma/yeniden adlandırma, aktiflik, çoklu teknik değer ve kullanım kontrollü silme ürün kimliklerini koruyor. Eski kataloglar şema 8/9 ile taşınıyor.
- Stok durumu, Hareketler, Transferler ve Sayımlar ayrı adreslere taşındı. Depo filtresi, sebebe bağlı giriş/çıkış, kayıtlı hareket bakiyesi/yazarı ve ilişkili transfer satırları eklendi. Ayrıntı ve açık farklar: [paket/stok doğrulaması](supsem-paket-stok-dogrulama.md).

## 24 Ekim 2026 — ana işlev tamamlama çalışması

- Altı kapsamlı marj motoru, iki hesap sırası, komisyon yöntemi, sabit fiyat/tutar/yüzde, yuvarlama, kapsam dışlama ve liste fiyatı eklendi. Otomatik fiyat kapatılınca son hesap korunur; Şimdi uygula açık işlemle yeniler.
- Pazaryeri genelinde kategori/marka/renk/varyant/teknik değer eşlemeleri eklendi. Önceki mağaza eşlemeleri ve ilandaki özel değerler önceliklidir.
- TCMB döviz türleri, ürün dövizinden TRY dönüşümü, satış kur/maliyet anlık görüntüsü ve KDV hariç ürün fiyat girişi eklendi. POS beklenen toplam kontrolü kur/fiyat değişince eski toplamla satış yapılmasını engeller.
- E-ticaret varsayılanları, negatif stok, depo kritik eşikleri, İstanbul gün sonuna göre termin ve sipariş PDF/görsel ekleri eklendi. Ekler yalnız firma oturumuyla indirilebilir.
- Hepsiburada kategori/özellik, JSON dosyasıyla yeni ürün gönderimi, durum izleme ve SKU+barkod doğrulaması eklendi. Gerçek hesap kabulü henüz yapılmadı.
- Önceki fiyat/eşleme turunda 152 teste ve 15 tarayıcı akışına ulaşıldı. Son birleşik regresyonun sonucu aşağıdaki Otomatik doğrulama bölümündedir.
- ToptanTR ortak stok planı eklendi: tamamı aynı fiziksel kaynağa bağlı baz/paket/koli, sıfır tampon, ayrı fiyat ve baz stok uçları, katalog doğrulaması ve eski plan koruması. İlgili 16 sözleşme/ortak stok testi geçti. Pazarama ve ToptanTR başarılı stok sonuçlarının işleyicide eşitleme kaydı oluşturması da düzeltildi.
- ToptanTR yeni üst ürün yayınlaması eklendi. Grup önizlemesi bütün varyantları doğrular ve tek istekle gönderir; üyeler aynı iş kimliğiyle kilitlenir, ayrı uzak varyant kimlikleriyle eşlenir. Üç API/işleyici grup senaryosu ile altı ortak stok senaryosu geçti.
- PttAVM tam üst ürün/varyant yayınlama, gruplu önizleme, kalıcı üst ürün kimliği, kaybolan yanıtın okuma yoluyla doğrulanması ve kardeş varyantları koruyan stok/fiyat eşitlemesi eklendi.
- Sekiz pazaryerinde sözleşmeye bağlı hazırlık/paket/kargo/iptal işlemleri sipariş detayına bağlandı. Çoklu paketler kargo listesinde ve siparişte görünür; etiketler kalıcı saklanır. Desteklenmeyen işlem başarı olarak sunulmaz.
- Paraşüt müşteri/ürün/fatura/resmileştirme adımları ve Yurtiçi/Aras/PTT belirsiz gönderi sonuçları için sağlayıcı referansıyla uzlaştırma eklendi. Aynı fatura veya gönderi otomatik ikinci kez oluşturulmaz.
- Değişen ve kısmen iptal edilen siparişler yerel kalem eşlemesi, stok/tutar etki önizlemesi ve revizyon korumasıyla uzlaştırılabilir. Önceki kalemler ve dondurulmuş paket/depo dağılımı saklanır.
- Mevcut ilan içerikleri alan seçimi, önizleme ve sağlayıcı onayıyla güncellenir: Trendyol, Hepsiburada, n11 açıklaması, Çiçeksepeti, PttAVM ve ToptanTR. Amazon mevcut-ASIN ve Pazarama için belgede olmayan katalog yazması oluşturulmadı.
- n11/Çiçeksepeti/Pazarama soru-yanıtları; n11/Hepsiburada/Çiçeksepeti/Pazarama iadeleri, desteklenen ret ve incelemeler eklendi. İade kanıtları firma/talep ilişkisiyle özel saklanır. Hepsiburada kayıt bazlı muhasebe ve n11 teslimat şablonları eklendi.
- Tüm/seçili e-ticaret depoları ve mağaza özel depo seçimi; çok depoda rezervasyon, onay ve kısmi iade; manuel TRY/USD/EUR/GBP siparişi, KDV dahil/hariç giriş, sabit kur/TRY defteri; yazdırıldı filtresi/takibi ve kalan yerel toplu işlemler eklendi.
- Ürün görselleri kalıcı renk değeriyle ilişkilendirilebilir; alternatif metin ve renkli varyantın doğru görselleri katalog/yayın/sipariş ekranlarına bağlandı.
- Her sağlayıcı çağrısında iş sahipliği ve bağlantı sürümü yeniden kontrol edilir. Stok veya yayın/fatura/sipariş kaynağı iki çağrı arasında değişirse eski planla sonraki yazma başlatılmaz.
- [Temsili şirket geçişi](supsem-gecis-provasi.md) mevcut API'lerle sınandı; gerçek şirket verisiyle geçiş ve canlı hizmet kabulü açıktır. Ayrıntılar: [paket/içerik/uzlaştırma](pazaryeri-paket-icerik-dogrulama.md) ve [fiyat/eşleme](supsem-fiyat-esleme-dogrulama.md).

## 25 Ekim 2026 — Supsem'e bakarak fatura eksiklerinin kapatılması

- Supsem'in Faturalar listesi, boş oluşturma formu, ödenmiş ve ödeme bekleyen mevcut belge ekranları yeniden incelendi. Gerçek Supsem kaydı üzerinde yazma/iptal/ödeme/silme yapılmadı.
- Önceki uygulamada yalnız sipariş kaynaklı taslaklar bulunduğu doğrulandı. Bağımsız fatura oluşturma ve tam sayfa detay/düzenleme eklendi; sahte sipariş kaydı oluşturulmaz.
- KDV hariç ürün/hizmet satırları, indirim, isteğe bağlı vade, TRY/USD/EUR/GBP, TCMB veya elle kur, etiket/not, depo ve tahsilat kaydı eklendi. Katalog kalemleri stoktan düşer; serbest satır stok yaratmaz.
- Yerel ödeme/geri alma, yerel fatura iptali/geri alma/silme atomik stok ve cari etkileriyle uygulanır. Ödenmiş veya sağlayıcıya aktarılmış belgeyi sessizce düzenleme/silme engellenir.
- Bağımsız fatura Paraşüt hazırlığına, tarih/kur/kalem doğrulamasına ve belirsiz yanıt uzlaştırmasına bağlandı. Yerel FT numarası salt okunur `invoice_no` alanına resmî numara olarak gönderilmez.
- Supsem'deki kategori ve toplu ödeme pencereleri yeniden incelendi: sürümlü kategori ekleme/yeniden adlandırma/pasife alma/kullanım kontrollü silme ve toplu tahsilat eklendi. Yöntem, tarih ve depo ortak seçilir; sipariş/fatura referansına bağlı önceki tahsilatlar düşülerek yalnız kalan tutar kasaya yazılır. Değişmiş tek üye bütün toplu işlemi durdurur.
- Paraşüt `SalesInvoice` kategori ilişkisi ve kaybolan kategori yanıtının salt okuma yoluyla kurtarılması eklendi. Yerel ad değişikliği, aktarılmış faturanın dondurulmuş uzak kategori ilişkisini değiştirmez.
- Elle kesilmiş resmî belge linki/isteğe bağlı numara ekranı yeniden incelenip uygulandı. Dış belge ilişkisi yeni fatura, stok veya tahsilat üretmez; GİB doğrulaması iddia edilmez. Dış belge bağlıyken düzenleme/silme/ikinci Paraşüt faturası kapalıdır. Desteklenen etkin mağazada link iletimi kaynak kontrollü ayrı kuyruk işi olarak başlatılır.
- Gönderilmemiş link işi, bağlantı kaldırmada atomik iptal edilir. Gönderilmiş/çalışan/belirsiz bağlantı önce doğrulanmalıdır. Bağımsız belgenin yerel iptal/geri almasında stok etkisi uygulanır ve dış belge ilişkisi korunur; dışarıda kesilmiş resmî belge iptal edilmez. Sağlayıcı resmî iptali ve otomatik fatura varsayılanlarının kalan ayrıntıları açıktır. Paraşüt'ün public OpenAPI'sinde `sales_invoices/{id}/cancel` bulunması e-belge/GİB iptalini doğrulamak için yeterli kanıt değildir.
- Kanıtlar ve kabul sınırları: [Supsem fatura doğrulaması](supsem-fatura-dogrulama.md). Son genel koşuda 264 alan/sunucu/adaptör testi ve 23 tarayıcı akışı geçti. Mobilde gerçek fatura listesi, kategori penceresi, elle bağlı dış belge detayı ve otomasyon ayarları kontrol edildi.
- Supsem'in fatura zamanı, yeni Paraşüt hesabı ve Trendyol senkron ayarları tekrar incelendi. Beş firma fatura zamanı, tek varsayılan Paraşüt hesabı, mağaza hesabı önceliği ve ayrı otomatik link anahtarı eklendi. Siparişe kaydedilen zaman ve mevcut belgenin bağlı hesabı ayar değişince sessizce değiştirilmez. Kanıtlar ve açık muhasebe alanları: [fatura otomasyonu](supsem-fatura-otomasyon-dogrulama.md).

## Güncel sağlayıcı kapsamı

Aşağıdakiler **kodlanmış işlemlerdir**; canlı hesapla başarılı kabul yapıldığı anlamına gelmez.

| Sağlayıcı | Adaptör işlemleri | Açık kabul / kapsam |
|---|---|---|
| Trendyol | Katalog/sipariş/stok/fiyat/fatura; V2 yayın ve içerik onayı; soru/yanıt; seçili iade onayı/kanıtlı ret; hakediş/banka eşleme; Picking, ortak ZPL, kendi kargo bildirimi, tedarik edememe | Gerçek hesap; sözleşmeye uygun taşıyıcı modeli ve çok paketli kısmi değişiklik kabulü |
| Hepsiburada | Katalog/ilan/sipariş/stok/fiyat/fatura; yeni ürün ve içerik ticket onayı; paket/ZPL/iptal/kendi kargo; normal Return onay/ret; kayıt bazlı muhasebe | Gerçek hesap; yeni ürün/eksik fatura/ön onay talepleri normal iade akışına dahil değil. API'de açık banka ödeme-emri ilişkisi yok |
| n11 | Katalog/sipariş/stok/fiyat/fatura; yayın/task ve açıklama güncelleme; teslimat şablonları; SOAP soru/yanıt; iade onay/ret/gün sayılı erteleme; Picking bildirimi | Gerçek hesap; güncel REST doğrudan etiket/kargoya verildi sunmuyor. Hakediş ucu güncel public belgede doğrulanamadı |
| Amazon Türkiye | LWA, Türkiye FBM, 2026 Orders, ASIN teklifi, stok/fiyat, satın alınabilirlik ve sayısal paket referansıyla kargo bildirimi | Gerçek hesap ve PII/vergi izinleri. FBA ve ASIN katalog içeriği değişimi kapsam dışı |
| Çiçeksepeti | Katalog/sipariş/stok/fiyat/fatura; yayın/kişiselleştirme/korumalı içerik; soru/yanıt; iade onay/ret; pazaryeri veya kendi kargo modeli | Gerçek hesap; ürün okumasında operatorContacts/safetyInfo eksikse içerik güncelleme durur. Sorgu aralıkları korunur |
| PttAVM | Api-Key/Access-Token REST; varyant katalog/sipariş; grup yayın/içerik; kardeşleri koruyan stok/fiyat; fatura; depo/barkod/çoklu etiket | Gerçek hesap, sayfalama ve katalog fiyat farkı kabulü. Token edinme/yenileme dokümanı yalnız yetkili hesaplarla paylaşılıyor |
| Pazarama | Token, cursor katalog, sipariş/stok/fiyat/fatura; yayın/marka/özellik; hazırlık/paket/kargo/iptal; soru/yanıt; iadede onay/ret/kanıtlı inceleme | Gerçek hesap; paket uç biçimi ve satıcı GUID'i kabulü. Genel katalog içeriği/hakediş ucu public sözleşmede tamamlanmadı |
| ToptanTR | Token, SKU–GTIN, yayın/içerik; Adet/Paket/Koli ortak stok; sipariş onayı/fatura; anlaşmalı/kendi çok kolili gönderi, etiket, sevk, tüm sipariş iptali | Gerçek hesap; ortak paket stoku tüm üyelerin eşlenmesini ve mağazada tek fiziksel depo seçimini gerektirir |
| Paraşüt | Müşteri/ürün/kategori, TRY/USD/EUR/GBP taslak ve kur/tutar doğrulaması, e-belge/PDF, belirsiz hazırlık/fatura/resmileştirme uzlaştırması | Gerçek firma ve resmileştirme kabulü; mevcut mali belgeyi değiştiren siparişte mali düzeltme önce tamamlanmalı; resmî iptal henüz kodlanmadı |
| Yurtiçi | Referans testi, gönderi/takip/iptal ve belirsiz yanıt uzlaştırması | Gerçek hesap ve taşıyıcıya kabul/etiket senaryosu |
| Aras | Referans testi, gönderi/barkod/teslimat ve referansla uzlaştırma | Gerçek hesap, barkod/koli kabulü; iptal sözleşmesi açık değil |
| PTT Kargo | WSDL kayıt/barkod/EPL/iptal ve tahsisli barkodla uzlaştırma | Tahsisli barkod/sözleşme kodlarıyla gerçek gönderi |
| DHL eCommerce/MNG | Token, il/ilçe, sipariş, barkod/ZPL, takip, iptal | ApiZone erişimi bu ortamda kapalı; sözleşme örnekleri açık kaynak istemcilerle çapraz kontrol edildi, resmî hesap kabulü şart |

## Genel yayından önce açık olanlar

Ürün/paket/sipariş ana akışları, perakende, temel tanımlar, marj/eşleme, çoklu depo, ekler/döviz/yazdırma ve sağlayıcının desteklediği platform kargosu kodlandı. Bu, bütün Supsem ekranlarıyla birebir özellik/parite veya canlı kabul iddiası değildir. Yeni kapsam kullanıcıyla karara bağlanır.

1. Sağlayıcıların gerçek test hesaplarıyla sipariş → stok → gönderi → fatura zinciri ve hata/tekrar kabulü.
2. Pazarama/ToptanTR adaptörlerinin gerçek hesap kabulü; özellikle sayfalama, fiyat onayı ve ortak paket stoku.
3. PttAVM yetkili hesap token dokümanı, DHL/MNG ApiZone doğrulaması; public sözleşmesi bulunmayan n11/Pazarama finans ve diğer sağlayıcı sınırları.
4. Yeni ve güncellenen ürünlerin gerçek mağaza inceleme/onay sonuçları. Paraşüt ve taşıyıcı belirsizliklerinin gerçek hesapla prova edilmesi.
5. Çok paketli/parçalı sevkiyat, iade kararları ve banka hakediş eşlemesinin gerçek kayıtlarla kabulü. Taşıyıcı gönderisi ile pazaryeri bildirimi ayrı adımlardır.
6. Mevcut resmî faturası ya da iade kaydı bulunan siparişlerin mali düzeltme süreci; bu kayıtlar genel kalem uzlaştırmasında sessizce yeniden yazılmaz. Fatura zamanı/varsayılan hesap/link anahtarı kodlandı; e-posta bekleme/uzak fatura sorgusu ve Paraşüt tahsilat/irsaliye/internet satışı sınırları [otomasyon doğrulamasında](supsem-fatura-otomasyon-dogrulama.md) açıktır. Gerçek firma ve resmî iptal kabulü hâlâ gerekir.
7. Gerçek Supsem şirket dışa aktarımıyla geçiş: stok sütununun anlamı, açık siparişlerin önceden uygulanmış çıkışları, ilan kimlikleri ve açılış bakiyeleri. Temsili prova geçti. Zamanlanmış uzak XML beslemesi ve Supsem'in bütün yardımcı/ileri ekranları bu teslimde kodlandı olarak sayılmaz.
8. Coolify staging kurulumu, gerçek PostgreSQL eşzamanlı worker/yük testi, yedekten geri yükleme ve SMTP teslimat testi. Docker daemon bu yerel ortamda çalışmadığından container build/run kabulü yapılmadı.

**Sonuç:** Yerel çekirdek iş akışları ve desteklenen sağlayıcı operasyonları genişletilip sınandı. Gerçek hesap/şirket ve dağıtım kabulü tamamlanmadığı için genel yayın hazır kabul edilmez.

## Otomatik doğrulama

- 26 Ekim son birleşik koşuda **269 test, 38 dosya** geçti. Mevcut 264 birim/alan/sunucu/adaptör regresyonuna beş kaynak düzeyinde tema sözleşmesi testi eklendi. Fatura zamanı, firma izolasyonu, kategori/tahsilat/dış belge/kaybolan yanıt ve stok/kur korumaları korunuyor.
- **38 tarayıcı senaryosu doğrulandı.** Son genel koşuda 37 test geçti; içerik onayının kuyruk/polling zamanlamasına takılan testin süresi, izdeki başarılı `applied` sonucu doğrulandıktan sonra 45 saniyeye düzeltildi ve bu akış ayrıca geçti. Tema, arama, ortak kart boşlukları, responsive dashboard ve normal/azaltılmış hareket kontrolleri de kapsamdadır. Mevcut otomasyon, sipariş, stok, POS, fatura, yayın ve uzlaştırma akışları izole hesaplarla denetlenir; gerçek sağlayıcı kabulü değildir.
- İlk genişletilmiş koşuda ortak test IP'si giriş kotasına takıldı. İki fatura test hesabı kayıt sırasında oluşturulan ayrı HTTP-only oturumlarla çalıştırılarak giderildi; üretim giriş hız sınırları gevşetilmedi. Gerçek giriş ekranı testleri korunuyor.
- Üretim frontend/server derlemeleri, lint ve format kontrolü geçti; Compose yapılandırması Docker Compose ile doğrulandı.
- Yerel `/api/health` ve `/api/ready` veritabanı/worker hazır sonucunu verdi. Ürün, paket, perakende ve sipariş ekranları masaüstü/390 px görünümde kontrol edildi; geniş tablolar kendi alanlarında kayıyor. Paket stok özeti koyu temada mobil olarak düzeltildi. Son görseller `C:\Users\hub\AppData\Local\Temp\opencode\pazarhub-catalog-review\` altında; önceki sipariş/soru/içe aktarma/hakediş kontrolleri de kayıtlıdır.
- Sürüm 0.3.0. Değişiklikler yerelde; üretim ortamına dağıtım yapılmadı.
- Son mobil kontroller `C:\Users\hub\AppData\Local\Temp\opencode\pazarhub-core-review\` altında; fatura listesi, kategori penceresi, elle bağlı belge detayı ve otomasyon ayarları da eklendi. Yerel geliştirme adresi `http://localhost:5173/ecommerce-settings`; üretim dağıtımı yapılmadı.

Son arayüz geri bildirimi: parola minimumu ortak olarak 8 karaktere indirildi; sayfa CSS yükleme sırası, başlangıç kartı boşlukları ve bildirim açılır paneli düzeltildi. Bunlar genel yayın kabulünün tamamlandığı anlamına gelmez.

26 Ekim arayüz kontrolü: çalışma alanı seçicisinde 36 px satırın 34 px kutuya taşması ve ayrı noktalı monogram düzeltildi. Açık/koyu tema, uzun ad, klavye menüsü ve mobil kontrol ile mevcut çalışma alanı regresyonları birlikte 7 tarayıcı testinde geçti. Genel tema için öneriler [tema incelemesinde](tema-inceleme.md) kayıtlıdır; kullanıcı onayı olmadan genel tasarım dönüşümü yapılmadı. Bu, canlı sağlayıcı/yayın kabulü değildir.

26 Ekim sonraki tema kararı: kullanıcı HeroUI Theme Builder default temasının bütün uygulamada kullanılmasını istedi. Tam açık/koyu palette aktarıldı; eski CSS, native bileşen stilinin altında katmanlandı. İlk kontrolün dışında kalan ayar butonu kenarlıkları, kart biçimli radiolar, pencere padding/çizgileri, native sınıfsız etiketler ve tablo ayırıcıları ikinci turda temizlendi. Kağıt çıktıları ve domain/marka renkleri korunur. Son genel koşuda 30 tarayıcı testi geçti; üretim oturum/kayıt limitleri değiştirilmedi. Geçiş ayrıntısı, kabul sınırları ve güncel görseller [tema incelemesinde](tema-inceleme.md).

Son derin tema temizliği: native görünüm sahipliği bütün kaynaklarda denetleniyor; eski palet takma adları, 147 görünüm ve 198 intrinsic ölçü deklarasyonu ile 64 kullanılmayan seçici temizlendi. Tema değişimi `npm run theme:apply -- "tema.css"` komutuyla tek dosyadan yapılır; `check:theme`, build ve lint'e bağlıdır. 13 CSS dosyası / 1.510 kullanımda sıfır ihlal doğrulandı. 32 senaryolu geniş tarayıcı koşusunun 30'u geçti; iki tema senaryosunun tek adetlik paket fikstürü düzeltilip altı tema/alternatif-tema testi birlikte başarıyla tekrarlandı. Son derlemeler ve 269 test başarılıdır. Ayrıntı: [tema değiştirme](heroui-tema-degistirme.md).

Testler gerçek pazaryeri hesabı veya gerçek kargo/fatura işlemi kullanmaz. Test kapsamı `tests/` ve `e2e/` dosyalarında görülebilir.

Onaylı görsel iyileştirme: sayfa başlıkları, native kart iç boşlukları ve KPI oranları ortak bileşenlerden düzenlendi. Dashboard'un grafik/kanal oranları dengelendi; kısa kart/sayfa/menü/grafik animasyonları ortak ritme bağlandı ve azaltılmış hareket tercihi doğrulandı. Tema tek dosyadan değişmeye devam eder. 14 CSS dosyası / 1.531 kullanımda stil sözleşmesi kontrolü, TypeScript, derlemeler, lint ve format geçti. [Ayrıntı ve video](tema-inceleme.md#onaylanan-görsel-iyileştirme-ve-hareket).

## Sözleşme kaynakları

- Trendyol: `https://developers.trendyol.com/`; Ürün V2, QnA, claims ve 2 Eylül 2026 güncellenmiş Cari Hesap Ekstresi belgeleri.
- n11: `https://developer.n11.com/` (17 Ağustos 2026 CDN kategori özellikleri, product-create/task-details) ve `https://api.n11.com/ws/SellerInvoiceService.wsdl`
- Hepsiburada: güncel `https://developers.hepsiburada.com/tr/companies/hepsiburada` portalının katalog, listeleme ve sipariş OpenAPI belgeleri.
- Amazon: `amzn/selling-partner-api-models` resmî deposu, Orders `2026-01-01`, Listings `2021-08-01`.
- Çiçeksepeti: `https://ciceksepeti.dev/`
- PttAVM: `https://developers.pttavm.com/tr`
- Pazarama: `https://isortagim.pazarama.com/auth/integration`
- ToptanTR: `https://sapi.toptantr.com/sapi/docs/real-swagger.json` (v4.12)
- Paraşüt: `https://apidocs.parasut.com/`, `parasutcom/api-doc/spec/swagger.yaml`.
- Yurtiçi: `https://ws.yurticikargo.com/KOPSWebServices/ShippingOrderDispatcherServices?wsdl`
- Aras: `https://customerws.araskargo.com.tr/arascargoservice.asmx?WSDL`
- PTT: `https://pttws.ptt.gov.tr/PttVeriYukleme/services/Sorgu?wsdl` ve `https://pttws.ptt.gov.tr/GonderiHareketV2/services/Sorgu?wsdl`.
- DHL/MNG: ApiZone portalı; endpoint/alan çapraz kontrolü için `Voxyfy/anadoluship` ve `logedosoft/DHL-Cargo-ERPNext` açık istemcileri. Bu, resmî sözleşme kabulü yerine geçmez.

## Canlı doğrulama

Kargo API hesaplarının mevcut olduğu kullanıcı tarafından belirtildi. Anahtarlar henüz uygulamaya girilmedi. Test fikstürleri gerçek hesap kabulünün yerine geçmez. Ürün gönderimi, gerçek sipariş ve gönderi, fatura resmileştirme ve teslim takibi hesaplar bağlandıktan sonra doğrulanır.

Supsem karşılaştırmasının ayrıntısı: [supsem-inceleme.md](supsem-inceleme.md).
