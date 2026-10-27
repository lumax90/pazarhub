# Marka yönleri — 27 Ekim 2026

Üç aday görsel kimlik. Uygulamanın teması **değiştirilmedi**; `src/` altında dosya yok, bu yüzden build, lint ve tema sözleşmesi etkilenmez.

| Yön | Kişilik | Vurgu | Nötrler | Yazı | Köşe | Sol menü |
|---|---|---|---|---|---|---|
| A · Petrol | Sakin, hassas, finans güveni | Derin petrol `oklch(52.5% 0.105 212)` | Hafif petrole çalan soğuk gri | Onest | 0.5rem | Koyu petrol |
| B · Kehribar | Sıcak, samimi, çarşı | Bakır/kiremit `oklch(55.5% 0.145 46)` | Kum tonlu sıcak | Plus Jakarta Sans | 0.625rem | Kum tonlu açık |
| C · Grafit | Monokrom, premium, sessiz | Mürekkep siyahı (koyu temada beyaz) | Nötr grafit | Geist | 0.375rem | Zeminle birleşik |
| D · Çini | Yerel, kültürel, zarif | İznik kobaltı `oklch(47% 0.17 266)`; koyu temada turkuaz | Krem fritte zemin, gece-indigo mürekkep | Figtree + Fraunces (başlık/rakam) | 0.5rem | Kobalt, çok soluk yıldız deseni, turkuaz etkin durum |
| E · Volt | Enerjik, net, "fosforlu kalem" | Mürekkep siyahı; ana eylemde volt `oklch(91.7% 0.2 114)`; koyu temada volt | Kemik zemin, kıl çizgili düz yüzeyler, soluk nokta ızgarası | Funnel Sans + Funnel Display | 0.375rem | Obsidyen, volt etkin durum |

D ve E ikinci turda araştırmaya dayanarak eklendi: Çini, İznik çinisinin tarihsel paletinden (kobalt, turkuaz, çim yeşili ve çininin en zor elde edilen rengi olan "domates kırmızısı" — burada tehlike rengi); Volt, Ramp'in tek kromatik vurguyu yalnız ana eylem ve etkin durumda kullanan monokrom sisteminden esinlenir. İkisi de yalnız tema değişkeniyle ifade edilemeyen bir kimlik öğesini önizleme ekinde gösterir: ayrı başlık yazı ailesi (`--font-display`) ve Volt'ta metin vurgusundan ayrılmış eylem dolgusu (`--action`). Bunlar planlanan token katmanının parçalarıdır.

## Dosyalar

- `<yön>.theme.css` — HeroUI tema dosyası. Mevcut `src/styles/heroui-theme.css` ile aynı biçimde; `npm run theme:apply -- design/marka-yonleri/<yön>.theme.css --check` ile doğrulanır (üçü de geçti).
- `<yön>.preview.css` — **yalnız önizleme** ekleri: yazı ailesini Google Fonts'tan yükler ve sol menüye kendi yüzeyini verir. Sol menü için bileşen ezilmez; HeroUI değişkenleri `.app-sidebar` kapsamında yeniden tanımlanır. Tema dosyası bu seçiciyi kabul etmediği için kalıcı karşılığı planlanan uygulama token katmanıdır.
- `karsilastirma/*.jpg` — 1. tur: Mevcut, A, B, C. `karsilastirma/tur2-*.jpg` — 2. tur: Mevcut, A, D, E. Her biri 2×2: Dashboard, Siparişler, Ürün detayı (açık) ve Dashboard (koyu). Tekil 1440×900 kareler `karsilastirma/tekil/` altında.

Görüntüler demo çalışma alanında (`?demo=1`), çalışan geliştirme sunucusuna Playwright ile CSS enjekte edilerek alındı. Yazı aileleri için Türkçe karakter alt kümesi (latin-ext) Google Fonts'ta doğrulandı.

## Gözlenen sınırlar

- **Kehribar:** Durum etiketlerinde `accent` tonu kullanıldığı için "Onaylandı" / "Kargoya verildi" turuncuya döner ve "Bekliyor" (amber) ile karışır. Turuncu vurgu Trendyol/Amazon logolarına da yakındır.
- **Grafit** ve **Volt:** Aynı etiketler griye döner; durumlar arası ayrım zayıflar. Grafik açık temada tek renklidir (Volt'ta koyu temada volt).
- **Volt:** Volt rengi açık zeminde metin olarak okunmaz; bu yüzden açık temada `accent` mürekkeptir ve volt yalnız dolgu olarak kullanılır. Kalıcı uygulamada `--action` token'ı gerekir.
- **Çini:** Durum etiketleri kobalt kalır ve "Bekliyor" ile karışmaz. Kobalt sol menü güçlü bir kimlik verir ama mevcut mavi temaya en yakın renk ailesidir; fark krem zemin, serif başlıklar ve turkuazdan gelir. Desen yalnız önizlemededir ve kalıcı uygulamada isteğe bağlıdır.
- Hangi yön seçilirse seçilsin durum renkleri `accent`'ten ayrılıp kendi token'larına (ör. bilgi/işlemde) bağlanmalıdır.
- Tema yalnız renk, yazı, köşe ve gölgeyi değiştirir. Yazı hiyerarşisi, yoğunluk ve yerleşim dört görüntüde de aynıdır; bunlar token/kalıp katmanının işidir.
