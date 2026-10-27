# Supsem arayüzü — kapsam ve farklar

Tarih: 23 Ekim 2026.

## İnceleme kapsamının düzeltilmesi

Önceki araştırma ana iş akışlarını ve çok sayıda menüyü kapsadı. **Her sayfanın, kartın ve açılır pencerenin bütün durumları eksiksiz incelenmedi.** Önceki notlar tam bir arayüz kabulü olarak değerlendirilmemeli.

Bu turda Supsem'in menüsü, perakende ana ekranındaki kısayollar, ürün listesi, mevcut ürünün temel bilgi ekranı ve yeni ürünün kategori → varyasyon tercihi → varyantsız ürün bilgileri adımları tekrar açılarak incelendi. Gerçek ürün veya işlem kaydedilmedi.

İlk Supsem incelemesinde ekran görüntüsü aracı masaüstünü görünür yakalayamadı ve sipariş oluşturma sayfası bağlantı tüneli hatası verdi. Sonraki turda kullanıcı oturumu yeniledi; sipariş listesi, filtre, yeni sipariş ve mevcut sipariş detayı canlı DOM üzerinden doğrulandı. Supsem'in resmî rehberleri ve yayımladığı ekran görselleri de okundu. Ayrıntı: [sipariş doğrulaması](supsem-siparis-dogrulama.md).

## Kullanıcıya yabancı gelen başlıca farklar

| Akış | Supsem'de görülen | Pazarhub'daki durum | Kalan uyum işi |
|---|---|---|---|
| Ana menü | Genel altında Dashboard, Siparişler, Müşteriler; ayrı Müşteri Talepleri grubu | Genel/Müşteri Talepleri, Tanımlamalar ve Stok alt dalları uygulandı | Sağlayıcı alt dallarını işlevleriyle tamamlamak |
| Yeni ürün | Tam sayfada kategori → varyasyon → ürün bilgileri; varyantsız ve varyantlı yollar | Üç adımlı tam sayfa; ortak kategori/varyant/teknik tanımları, en fazla 3 varyant tipi/500 kombinasyon ve depo seçimi | Bağımsız kategori şablonu varsayımı ayrıca doğrulanmalı |
| Ürün detayı | Tam sayfa; Ürün Bilgileri, Stoklar, Fiyatlar, Detay Açıklama, Barkodlar, Resimler, Varyantlar, Teknik Özellikler, Entegrasyonlar | Dokuz sekmeli tam sayfa; kart bazında kayıt, stok defteri, eksik kombinasyon ekleme ve mağaza ilanlarına geçiş | Supsem'deki diğer alt kart ve hata/yetki durumlarının karşılaştırılması |
| Ürün temel bilgileri | Fatura adı, tedarikçi, birim, menşei, GTIP, ölçüler/desi gibi alanlar | Kalıcı alanlar, döviz/KDV giriş esası, renkli görseller ve dondurulmuş satış bilgisi | Gerçek mağaza kabulü |
| Paket ürün | Kategori → içerik → paket bilgileri; bağlı veya sabit fiyat; bileşenlerden stok | Paket formu, dondurulmuş içerik, çok depo ve ToptanTR ortak Adet/Paket/Koli stok uyarlaması | Gerçek mağazanın ortak stok kabulü |
| Ürün listesi | Filtre, sütun seçimi, Excel/CSV; satırdan görsel büyütme ve stok güncelleme | Sütun menüsü, görsel büyütme, hızlı stok düzeltme, URL'de filtreler ve CSV/XML aktarımı | Diğer filtre ve tanımlama seçenekleri |
| Perakende çalışma alanı | Yeni satış, iade, alış, kasa/cari, eski satışlar ve stok için kısayol ekranı | Altı işlem kartı, kasa/cari bağlantıları, günlük özet, geçmiş satışlar ve perakende menüsü | Satış/iade/alış formlarındaki ayrıntılı Supsem karşılaştırması |
| Sipariş listesi | Tarih, kayıtlı filtreler, sütunlar, hazırlık/fatura sütunları ve toplu işlemler | Filtre/sütun/çıktı; toplu onay, yerel iptal, KDV, fatura taslağı, hazırlık ve yazdırıldı yönetimi | Sağlayıcı toplu kargo/iptal ekranlarının ileri varyasyonları |
| Yeni sipariş | Tam sayfa müşteri/kaynak, alıcı, ödeme, fatura ve ürün/hizmet kalemleri | Ayrı adresler, ön tahsilat, hizmet, indirim/not, Paraşüt Hemen; TRY/USD/EUR/GBP, KDV dahil/hariç ve çok depo | Gerçek iş kayıtlarıyla operatör kabulü |
| Sipariş detayı | Solda ürün/geçmiş; sağda fatura, notlar, ekler, müşteri, tahsilat, kargo | Özel ekler, paket/etiket/kargo işlemleri, değişen kalem/stok/tutar ve fatura/taşıyıcı uzlaştırması | Sağlayıcı özel akışları ve mali düzeltme kabulü |
| Stok / tanımlamalar | Menü altında ayrı alt sayfalar | Kategori/marka/tedarikçi/renk/varyant/teknik/depo; kritik stok eşikleri, e-ticaret depoları ve sağlayıcı genel eşlemeler | Gerçek veriyle kapsamlı rol/hata kabulü |
| Entegrasyonlar | Pazaryeri, kargo, muhasebe ve sağlayıcı dalları | Ortak bağlantı listesi ve düzenleyici | Sağlayıcıya doğrudan giriş, varsayılanlar ve ekran yerleşimi |
| Bildirim erişimi | Üst çubukta bildirim tetikleyicisi | Bu turda zilin altına açılan panele çevrildi | Şu anki öncelikli iş özetinden kalıcı bildirim akışına genişleme |

Ana fark, menü isimlerinin yanında **kaydın nerede açıldığı, hangi sırayla doldurulduğu ve hangi sekmelerden yönetildiği**. Ürün → varyant → mağaza ilanı veri ilişkisi kurulmuş olsa da arayüz uyumu ayrıca tamamlanmalı.

## Bu geri bildirimde yapılan düzeltmeler

- Kayıt, davet kabulü, parola değiştirme ve parola yenilemede ortak minimum: 8 karakter.
- Genel CSS'ten sonra sayfa stilleri yükleniyor. Başlangıç kartında masaüstü 24 px, mobil 18 px iç boşluk doğrulandı.
- Bildirim paneli sağ üstteki zile bağlı açılıyor; Escape, dışarı tıklama ve kayıt seçimiyle kapanıyor.
- Bildirim panelinin mobil genişlik sınırı ve satırların dar alanda üst üste binmesi düzeltildi.
- Sorular ve pazaryeri iadeleri Müşteri Talepleri grubuna taşındı; Genel grup sadeleştirildi.

Doğrulama: ilgili 11 sunucu testi ve 11 tarayıcı akışı geçti; frontend/server derlemesi, lint ve format kontrolü başarılı. Ayrı bellek içi çalışma alanında 8 karakterli parola kaydı, masaüstü/mobil kart boşlukları, açılır panel konumu, Escape/dışarı tıklama, odak dönüşü ve menüden gezinme kontrol edildi. Mobil panel 390 px ekranda 366 px genişlikte; yatay taşma veya üst üste binen bildirim satırı görülmedi.

## Devam iterasyonu — ürün ve perakende

- `/products/new`: kategori → varyasyon → ürün bilgileri. Kombinasyonlar tekrar üretildiğinde kalan varyantların kimlikleri, barkodları, fiyatları ve girilmiş miktarları korunur. Açılışlar seçilen depoya atomik kaydedilir.
- `/products/:id?tab=…`: dokuz sekmeli ürün çalışma alanı. Bir kartın kaydı yalnız kendi alanlarını değiştirir; diğer sekmelerdeki taslaklar korunur. Sürüm uyuşmazlığında kayıt reddedilir; stok düzeltmesi ayrıca başlangıç bakiyesini kontrol eder.
- Teknik özellik ve varyant değerleri ilan hazırlığında “Üründen doldur” ile alınabilir. Özellik adı ve listeli değer tekil olarak eşleşmeli; mevcut ilan/kategori seçimleri korunur. Bu, sürekli bağlı kategori şablonu mirası değildir.
- Paraşüt kaleminde satışın kayıtlı fatura adı ve birimi kullanılır. Mevcut Paraşüt ürününün birimi farklıysa taslak işleme devam edilmeden hata döner.
- `/retail`: satış, iade, alış, kasa, eski satışlar ve stok kısayolları. `/retail/sale`, `/retail/history`, `/retail/returns`, `/retail/inventory`, `/retail/finance/:view` aynı perakende menüsü ve geri dönüş bağlantısıyla açılır.
- Dokuz ürün sekmesi 390 px ekranda kontrol edildi; sayfada yatay taşma yok. Geniş tablolar kendi alanlarında kaydırılır. Ürün ve kategori seçimi açık temada, perakende ana ekranı açık/koyu temada görüntüyle incelendi.

Son doğrulama: 104 alan/sunucu/adaptör testi, 12 tarayıcı akışı ve frontend/server derlemesi başarılı. Tarayıcı testinde dört kombinasyonun seçili depoya açılışı, görsel yükleme, kart bazında kayıt, teknik özellikler, barkod satışı ve fatura adı/birim anlık görüntüsü doğrulandı. Test sunucusundaki ürün çalışma alanı fikstürü ayrı hesaptır; üretim kayıt hız sınırları gevşetilmedi.

## Sonraki arayüz kabulü

Paket/tanımlama turu: 136 alan/sunucu/adaptör testi ve üretim önizlemesindeki 14 tarayıcı akışı geçti. Paket sihirbazı, kategori ağacı, stok hareketleri masaüstünde; paket stok kartı 390 px koyu temada incelendi. Mobil içerik özeti iyileştirildi; yeni paket/tanım ve sipariş senaryoları son değişikliklerle yeniden geçti.

Paket, temel tanımlar ve stok gezinmesi iterasyonunun kaydı: [paket/stok doğrulaması](supsem-paket-stok-dogrulama.md). Sonraki öncelik: gelişmiş marjlar ve sağlayıcı eşlemeleri → eksik yayınlama → sipariş/kargo süreçlerinin sağlayıcıya bağlı kalan ayrıntıları.

Her hedef akışta liste, boş oluşturma formu, mevcut kayıt, ilgili sekmeler ve açılır kontroller kaydedilmeli; boş/dolu/hata/yetki durumları ayrıca doğrulanmalı. Bu inceleme tamamlanmadan “Supsem'in bütün ekranları incelendi” veya “arayüz uyumu tamamlandı” ifadesi kullanılmamalı.

İşlevsel kapsam ve yayın açıkları: [Yayına hazırlık](yayin-hazirligi.md).

## 24 Ekim — çekirdek kabul güncellemesi

215 alan/sunucu/adaptör testi ve 19 tarayıcı akışı geçti. Siparişin çok depo/döviz/KDV/yazdırma ayrıntıları, renge bağlı görseller, yayın/içerik ve paket/iade/fatura uzlaştırması eklendi. Mobil sipariş, paket/etiket, ürün detayı ve hakediş görüntüleri `pazarhub-core-review` geçici klasöründe saklandı. Bu kabul genel Supsem paritesi veya gerçek sağlayıcı hesabı kabulü değildir.

## 25 Ekim — fatura ekranını yeniden doğrulama

Supsem'de bağımsız fatura, tam sayfa detay/düzenleme, KDV hariç fiyat, vade/döviz ve ödeme/geri alma ekranları tekrar okundu. Mevcut uygulamanın yalnız sipariş kaynaklı taslakları desteklediği fark edildi ve bu akış eklendi. Kanıtlar ile uygulanmayan kategori/toplu tahsilat/elle resmî belge ve resmî iptal sınırları [fatura doğrulamasında](supsem-fatura-dogrulama.md) ayrı tutuluyor. Son genel test sonucu 226 test / 32 dosyadır.
