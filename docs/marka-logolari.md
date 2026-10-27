# Pazaryeri ve kargo logoları

27 Ekim 2026. Kullanıcının onayıyla harflerden oluşturulan geçici marka simgeleri ve kargo hesaplarının genel kamyon ikonu, gerçek marka görselleriyle değiştirildi.

## Ortak kullanım

- `src/lib/provider-logos.ts`, sekiz pazaryeri ve dört kargo sağlayıcısını yerel dosyalarla eşleştirir. `src/components/ui/ProviderLogo.tsx` ortak görsel bileşenidir; mevcut `ChannelIcon` ve entegrasyon sayfasındaki kargo ikon alanları bu bileşeni kullanır.
- Mevcut dış ölçüler korunur: genel kanal ikonu 22 px; tablo 18 px, ürün kanal grubu 20 px; entegrasyon kartı 44 px / mobil 37 px; kargo sağlayıcı alanı 48 px. İç görseller `object-fit: contain` kullanır; en/boy oranı değişmez.
- Marka renkleri temaya göre boyanmaz. Transparan görsellerin açık/koyu zeminde görünürlüğü ortak beyaz marka alanıyla korunur; bu zemin yalnız marka içeriğine aittir, UI paleti değişmez. Duraklatılan bağlantıda mevcut opacity durumu korunur, grayscale filtresi kaldırılmıştır.
- Manuel kanalın `m` simgesi ve fatura sağlayıcısının genel belge ikonu bu kapsamda değiştirilmedi. Sağlayıcı kimlikleri, bağlantı adları, API ayarları ve iş akışları aynı kalır. `dhl`, mevcut DHL eCommerce/MNG bağlantısının kimliğidir; ikinci bir MNG bağlantısı oluşturulmaz.

## Kaynak ve işlem kaydı

Kaynak sayfaları, indirilen görsel URL'leri, kaynak/dosya SHA-256 değerleri ve doğal görsel boyutları [provider-logo-sources.json](provider-logo-sources.json) içinde kayıtlıdır.

- Hepsiburada, n11, Amazon Türkiye, Çiçeksepeti, PttAVM, ToptanTR ve DHL eCommerce simgeleri markanın kendi sitesinde kullanılan favicon veya touch-icon dosyalarından alınmıştır.
- Trendyol, Pazarama, Yurtiçi, Aras ve PTT için resmî uygulama yayımcısının simgesi kullanılmıştır. Yayımcılar sırasıyla DSM Grup, Topkapı Danışmanlık, Yurtiçi Kargo Servisi, Aras Kargo ve T.C. Posta ve Telgraf Teşkilatı olarak doğrulanmıştır; üçüncü kişilerin kargo takip uygulamaları kullanılmamıştır.
- PNG kaynaklar aynen saklanmıştır. JPEG/ICO kaynaklar doğal çözünürlüklerinde PNG'ye dönüştürülmüştür; yeniden çizim, renk değiştirme, kırpma veya yapay çözünürlük artırma yapılmamıştır. Dosyalar `public/brands/` altındadır; çalışma sırasında dış marka/CDN isteği yapılmaz.
- Logolar ilgili marka sahiplerine aittir. Burada sağlayıcıyı tanıtmak için kullanılır; ortaklık veya onay iddiası oluşturmaz. Açık bir genel kullanım lisansı varsayılmamıştır; üretim yayını öncesinde ilgili marka kullanım koşulları ayrıca kontrol edilmelidir.

## Kontroller

- `tests/provider-logos.test.ts`: 12 sağlayıcının eksiksiz eşleştirilmesi, yerel PNG dosyalarının doğal boyutları ve kayıtlı hash değerleri.
- `e2e/provider-logos.spec.ts`: açık/koyu görünümde sekiz pazaryeri, eski ikon ölçüleri, mobil kartlar, orantılı yerleşim ve dış görsel isteği olmaması.
- `e2e/heroui-live-theme.spec.ts`: yalnız izole test hesabında pazaryeri/kargo sağlayıcı listeleri ve boş bağlantı formları; kargo logoları masaüstü ve mobilde 48 px alanlarını korur. Gerçek hesap anahtarı girilmez, sağlayıcı işi başlatılmaz.

Son doğrulamada 18 logo/tema birim testi ve açık/koyu, mobil, sağlayıcı formları ve alternatif temayı kapsayan 6 tarayıcı senaryosu geçti. TypeScript/build, lint, tema sözleşmesi ve format kontrolü başarılıdır.
