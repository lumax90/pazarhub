# Sipariş akışı — doğrulanan kapsam

23 Ekim 2026. Kullanıcının son sınırı: önce ana kapsam; Supsem'de bulunmayan yeni işlevler ayrıca anlatılıp karara bağlanacak.

## Kaynaklar

- Oturum yenilendikten sonra canlı `/dashboard/orders`, `/dashboard/orders/new` ve mevcut siparişin detay sayfası açıldı. Filtre paneli de açılarak alanlar okundu. Mevcut kayıt üzerinde durum, hazırlık, not, tahsilat veya kargo yazması çalıştırılmadı.
- [Siparişler nasıl yönetilir?](https://supsem.com/yardim/siparisler-nasil-yonetilir)
- [Elle sipariş nasıl oluşturulur?](https://supsem.com/yardim/elle-siparis-nasil-olusturulur)
- [Kargo gönderisi ve etiket](https://supsem.com/yardim/siparis-icin-kargo-gonderisi-ve-etiket-nasil-olusturulur)
- [Siparişten fatura](https://supsem.com/yardim/siparisten-fatura-nasil-kesilir)
- [Sipariş iptali](https://supsem.com/yardim/siparis-nasil-iptal-edilir)
- Görsel referans: Supsem'in yayımladığı `/help/siparisler/sayfa.webp` ve `/help/elle-siparis/form.webp`. Bunlar canlı oturum ekran görüntüsü değildir; güncel formdaki bazı düzenler değişmiştir.

## Doğrudan gözlenenler

| Alan | Kanıtlanan davranış |
|---|---|
| Liste | Son 7 gün; başlangıç/bitiş tarihi, no/müşteri/alıcı/takip araması, durum sayımları, sütun seçimi |
| Sütunlar | Sipariş No, Sipariş Veren, Ürünler, Tarih, Son Kargoya Verilme Tarihi, Kaynak, Durum, Hazırlık, Fatura, Toplam Tutar, İşlemler |
| Filtre | Durum, tarih, kaynak, mağaza, kargo firması, tahsilat, fatura, yazdırma, eşlenmemiş ürün ve anlaşmalı gönderi; filtre kaydetme |
| Detay | Tam sayfa. Solda Ürünler ve Sipariş geçmişi; sağda Fatura, Sipariş notları, Ekler, Müşteri, Tahsilat, Ödeme ve kargo |
| Hazırlık | Kalemlerde Hazır kutuları. Rehberde Hepsi hazır seçeneği de açıklanıyor |
| Notlar | Metin girişi ve Not ekle; rehberde firma kullanıcılarıyla ortak olduğu belirtiliyor |
| Yeni sipariş | Müşteri/kaynak ve gönderim adresi kartları; kaynak sipariş no, ödeme yöntemi/tahsil edildi, ayrı fatura adresi, ürün/hizmet satırları, indirim, KDV, kargo bedeli, müşteri notu ve iç not |
| Serbest satır | Katalogdan seçilmeyen ürün/hizmet adı; ürün kaydı ve stok hareketi oluşturmaz |
| Fatura | Ayara göre, Hemen, Resmîleşmesin seçenekleri; detayda fatura kaydına geçiş |

## Uygulama sınırları

- Başka sağlayıcıda başarılı olmuş bir işlem veya aynı adı taşıyan düğme, desteklenmeyen sağlayıcı için başarı kanıtı sayılmayacak.
- Paket/sipariş bölme rehberde koşullu olarak yer alıyor; sağlayıcı sözleşmesi ve ana işlem zinciri tamamlanmadan buna ait çalışmayan düğme eklenmeyecek.
- Mevcut uygulamanın tutarları integer kuruş ve KDV dahil saklanıyor. Canlı Supsem formunda KDV hariç giriş etiketi görüldü; bu iki fiyat anlamı karıştırılmayacak.
- Döviz, ekler, ileri toplu işlemler ve yazdırma şablonları kaynakta var; her birinin kabulü ayrıca takip edilecek. Bu çalışma bütün Supsem ekranlarının tamamlandığı iddiası değildir.

## Uygulanan sipariş iterasyonu

- Liste: son 7 gün, tarih aralığı, müşteri/alıcı/kaynak no/takip araması, kaynak/mağaza/kargo/tahsilat/fatura/eşlenmemiş/gönderi filtreleri. Kayıtlı filtreler firma belgesinde, sütun tercihleri kullanıcı üyeliğinde saklanır.
- `/orders/new`: tam sayfa müşteri/kaynak ve gönderim kartları; müşteri arama ve yerinde müşteri oluşturma, ayrı fatura adresi, kaynak numarası, ödeme yöntemi/tahsilat, depo, katalog veya serbest satır, yüzde/tutar indirimi, müşteri/iç not.
- `/orders/:id`: ürünler ve geçmiş solda; fatura, notlar, müşteri, tahsilat ve gönderi kartları sağda. Hazır/Hepsi hazır gerçek komutla kaydedilir; değişmiş sipariş kalemlerinde eski hazırlık isteği reddedilir.
- Fatura kes yerel taslağı oluşturur ve onayda ikinci taslak/ikinci stok düşümü oluşmaz. Hemen tercihi doğrulanmış Paraşüt hesabını ve finans yetkisini zorunlu tutar; fatura/kuyruk ile sipariş/tahsilat aynı veritabanı işleminde kaydedilir. Resmileştirme sonucu sağlayıcı işinden gelir.
- Serbest satır, eşlenmemiş pazaryeri satırından farklıdır. Katalog veya stok kaydı oluşturmaz; eşlenmemiş pazaryeri satırı onay için eşleme gerektirmeye devam eder.
- Yerel gönderim durumunda kargo firması/takip bilgisi girilir. Tam iadede depoya dönüş seçilebilir; ikinci iade stok veya tahsilatı tekrar etkilemez. Pazaryeri yazması bulunmayan durumlar yerel başarı olarak gösterilmez.
- Toplu onay, uygun yerel kayıtların iptali ve fatura/sevk öncesi KDV değişimi; atlanan/başarısız kayıtlar ayrı açıklamayla gösterilir. Sipariş detay çıktısı tekli/toplu açılır.
- Siparişten mevcut kargo gönderi formu ve fatura düzenleyicisine erişilir. Çelişen ikinci gönderi isteği ve uzlaştırma hatası bulunan siparişin gönderisi reddedilir.
- Tarayıcı testinde görülen ürün seçici kapanma davranışı düzeltildi. Statik uygulama dosyalarının API kotasını tüketip parça yüklemelerini engellemesi de düzeltildi; API ve giriş kotaları ayrıca test edildi.

## Doğrulama

- 116 alan/sunucu/adaptör testi; 13 tarayıcı akışı başarılı.
- Yeni sipariş testi: katalog + serbest hizmet, indirim, farklı alıcı, ön tahsilat, depo, hazırlık, not, tek fatura, kargo bilgisi, stoka almadan tam iade, çıktı sayfası, filtre ve sütun kalıcılığı.
- Frontend/server derlemesi, lint ve biçim denetimi başarılı. Liste, form, detay ve filtre paneli masaüstü/mobil; detay ve filtre paneli koyu temada görüntüyle kontrol edildi.
- Bu testler gerçek Paraşüt/kargo/pazaryeri hesabıyla kabulün yerine geçmez. Kaynakta görülen paket bölme, platform etiketi, sağlayıcı iptalleri, ekler, döviz/KDV giriş esası ayarları ve kalan toplu işlemler açık kabul kalemleridir.

## 24 Ekim — devam sonucu

Özel dosya ekleri, desteklenen platform paket/etiket/kargo/iptal işlemleri, kontrollü kalem ve belirsiz fatura/taşıyıcı uzlaştırması eklendi. Manuel sipariş TRY/USD/EUR/GBP ve KDV dahil/hariç tutarlarla oluşturulabilir; TCMB kur/tarih ve TRY defter karşılığı sabittir. Çok depolu rezervasyon/çıkış ve kısmi iadede doğru depoya dönüş uygulanır. Yazdırıldı işareti çıktı içeriğini izler; toplu hazırlık, fatura taslağı ve yazdırma yönetimi vardır.

Son birleşik kabul 215 alan/sunucu/adaptör testi ve 19 tarayıcı akışıdır. Sağlayıcı sözleşme sınırları, gerçek hesap ve mali düzeltme kabulü [paket/içerik doğrulamasında](pazaryeri-paket-icerik-dogrulama.md) kayıtlıdır.
