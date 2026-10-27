# Tema incelemesi ve çalışma alanı seçicisi

26 Ekim 2026. Kullanıcının paylaştığı ekran görüntüsü, mevcut CSS/JSX ve örnek çalışma alanı incelendi. Gerçek çalışma alanı adı, hesap veya işletme verisi değiştirilmedi. Seçici düzeltmesinden sonra kullanıcı **custom tasarım değil, HeroUI Theme Builder'daki native default temanın bütün uygulamaya uygulanmasını** istedi. Aşağıdaki geçiş bu kapsamda yapıldı.

## Düzeltilen küçük bileşen

- `company-avatar` 34 px iken harfin hesaplanan satır yüksekliği 36 px idi. Ayrı, mutlak konumlandırılmış nokta serifle birlikte bozuk bir logo izlenimi oluşturuyordu.
- Gösterge gerçek firma logosu değil, firma adından türetilen bir monogramdı. Artık aynı yazı ailesinde tek büyük başharf, 32×32 px sabit kutu ve açık satır yüksekliği kullanılır. Dekoratif harf/ikon ekran okuyucuda tekrar okunmaz.
- Sabit yeşil renkler kaldırılıp mevcut tema değişkenleri kullanıldı. Uzun firma adı tek satırda ellipsis ile sınırlandı, tam ad `title` ve erişilebilir düğme adında korunur. Ok/başharf/metin hizası, hover ve klavye odağı denetlendi.
- `e2e/workspace-selector.spec.ts` önce 36 px > 32 px iç yükseklik nedeniyle hatayı tekrar üretti. Düzeltmeden sonra açık/koyu tema, uzun ad, Enter/Escape menü etkileşimi ve mobil görünüm geçti. Mevcut altı çalışma alanı tarayıcı regresyonuyla birlikte **7 test geçti**; TypeScript, üretim derlemeleri ve lint başarılıdır.
- Karşılaştırma görselleri: `C:\Users\hub\AppData\Local\Temp\opencode\pazarhub-design-review\workspace-selector-before.png`, `workspace-selector-after.png`, `workspace-selector-dark.png`.

## Onaylanan native tema

**Güncel uygulama yolu:** [Tek komutla tema değiştirme ve stil sözleşmesi](heroui-tema-degistirme.md). Aşağıdaki ilk/ikinci kontrol kayıtlarının ardından bütün kaynaklarda temizlik yapıldı; geçmişteki “görünüm tamamlandı” ifadeleri evrensel ekran/durum kabulü anlamına gelmez.

- Seçim: <https://heroui.com/en/themes?lightness=0.6204&chroma=0.195&hue=253.83>.
- Önceki “aynı tema zaten kurulu” ifadesi yalnız paket/accent düzeyinde doğruydu; uygulamanın görünümü aynı değildi. Builder, nötr renkleri de hue'ya göre değiştiriyor ve eski uygulama CSS'i native bileşen görünümünü eziyordu.
- `src/styles/heroui-theme.css`, seçilen sayfanın gerçek açık/koyu nötr ve durum paletini, Inter fontunu, 0.5 rem ana köşe ve 0.75 rem alan köşesini taşır. Native hesaplanan renkler, gölgeler ve bileşen stilleri `@heroui/styles` tarafından sağlanır.
- `src/styles.css` artık tek CSS girişidir: eski sayfa yerleşimleri `app-layout` katmanındadır, HeroUI `components` onun üzerindedir. `structure.css` yalnız geniş form/çekmece/arama ikonu/mobil yerleşim gibi yapısal istisnaları tutar; ikinci bir renk paleti yoktur.
- Buton, kart, alan, tablo, menü, etiket ve checkbox/radio görünümünü ezen eski deklarasyonların ilk temizliği yapıldı. Küçük custom yazı ölçüleri ve kutu köşeleri HeroUI'nin ortak ölçeklerine bağlandı. Daha sonra kullanıcının kalan çakışma bildirimiyle aşağıdaki kapsam genişletildi; ilk kontrol bütün durumları kapsamıyordu.
- Ortak seçim düğmesi, aynı kontrollü Menu/onAction davranışını koruyup HeroUI'nin native `Dropdown.Trigger` ve `select__trigger` alan stilini kullanır. Tarih/metin/textarea HTML alanlarında da native stil sınıfları kullanılır; kayıt değerleri ve komutlar değiştirilmez.
- Seçili filtre/mod butonları native `secondary/ghost` varyantlarını kullanır. Tema/yoğunluk seçimleri HeroUI Button oldu; mobilde eski arama/menü işlevleri korunarak kontrollerin taşması giderildi. Giriş/kayıt ekranı oturum yokken sistemin açık/koyu görünümüne uyar; kayıtlı hesabın teması ayrıca korunur.
- Pazaryeri logoları, ürün renkleri ve kanal kimliği renkleri veri/marka içeriğidir; tek UI accent rengine çevrilmez. Mevcut kağıt çıktı stilleri ayrıca yüksek öncelikle korunur: ekrandaki koyu tema yazıcıya siyah sayfa basılmasına neden olmaz.

## Görsel kabul

- `e2e/heroui-theme.spec.ts`: artık 30 uygulama rotasında her iki tema için palette, native bileşen kontrolleri; yedi ürün detay sekmesi, açık filtre, form penceresi, fare/klavye menüsü ve 390 px görünümde ana ekranlar; giriş/kayıt testi. Başlangıçta yalnız ilk kart/alan/buton örneği kontrol edildiği için sonradan görünür olan veya primitive kökünde kalan kurallar kaçabiliyordu.
- `e2e/workspace-selector.spec.ts` ve mevcut çalışma alanı regresyonlarıyla birlikte hedef koşuda **11 tarayıcı testi geçti**. Ardından genel koşuda **264 alan/sunucu/adaptör testi (37 dosya)** ve **28 tarayıcı akışı** geçti. Yeni tema testleri ile mevcut sipariş/stok/POS/fatura/yayın/uzlaştırma akışları birlikte doğrulandı; bunlar canlı sağlayıcı kabulü değildir.
- Son görseller `C:\Users\hub\AppData\Local\Temp\opencode\pazarhub-native-theme-review\` altında: `dashboard-light.png`, `dashboard-dark.png`, `orders-light.png`, `orders-dark.png`, `orders-mobile.png`.

## Kalan çakışmaların ikinci kontrolü

- CSS katmanları tek başına yeterli değildir: HeroUI bir özelliği belirtmiyorsa daha düşük `app-layout` katmanındaki eski kenarlık, gölge veya zemin yine uygulanabilir. Ayrıca üst kapsayıcıdan devralınan yazı stilleri ve pseudo-elementler ayrı kontrol edilmelidir.
- Ayarlar tema/yoğunluk butonlarından eski seçim kenarlığı ve gölgesi; pencere başlığından özel harf aralığı; pencere başlık/alt bölümünden çizgi ve zemin; sipariş fatura tercihi ve ürün varyasyon radiolarından eski kart görünümü kaldırıldı.
- Pencerelerde eski sıfır dış padding korununca native 3 px body padding'i içerikleri kenara yapıştırıyordu. Native 24 px dialog padding'i geri bırakıldı; header/footer'daki eski ek padding kaldırıldı. Mobilde yalnız 16 px yatay boşluk yapısal istisna olarak tutulur.
- HTML seçim/textarea etiketleri ve tarih alanlarının metinleri doğrudan HeroUI `label` sınıfını kullanır; ikinci bir etiket rengi veya yazı kuralı üretilmedi. Alan değerleri, seçimler, zorunluluk ve olay işleyicileri aynı kaldı.
- Native tablo başlıklarının kısa dikey ayırıcılarını gizleyen eski `::after` kuralı ve eski filtre butonu pseudo-elementi kaldırıldı.
- `e2e/native-skin.ts`, görünür native primitive'leri, HTML native stil sınıflarını ve oluşturulan `::before/::after` içeriğini aynı DOM/tema/durum ile **uygulama CSS katmanları çıkarılmış** referansa karşı karşılaştırır. Kökleri tek başına kopyalamaz: bu, menülerin devraldığı yazı ölçüsünü kaybedip yanlış fark üretir. Renkler, eşdeğer OKLAB/OKLCH metinleri yerine gerçek RGBA olarak karşılaştırılır. Geniş pencere/tablo yoğunluğu gibi işlevsel yerleşim ölçüleri bu skin kontrolünden ayrı tutulur.
- Denetimin eski alt-katman kenarlığını gerçekten yakaladığı testte kontrollü stil ekleyerek doğrulanır; yalnız boş fark listesine güvenilmez.
- `e2e/heroui-live-theme.spec.ts`, izole API/veritabanında iki yeni test hesabıyla canlı moda özgü sağlayıcı formlarını, ürün sihirbazının sonraki adımlarını ve CSV eşleme penceresini kontrol eder. Hesap anahtarı girilmez, sağlayıcı çağrısı veya ürün/entegrasyon kaydı oluşturulmaz. Görsel test için oluşturulan kategori yalnız izole test firmasındadır.
- İkinci kontrolün altı tema testi ve son genel koşunun **30 tarayıcı akışı** geçti. Birim/alan/sunucu/adaptör koşusunda **264 test (37 dosya)** başarılıdır; TypeScript, arayüz/sunucu derlemeleri, lint ve format kontrolü geçti. Canlı form testlerinin iki hesabı da mevcut test başlangıç-kayıt/HTTP-only oturum düzenine alındı: genel kayıt hız sınırı gevşetilmedi, yalnız paralel görsel testlerin ekip testiyle aynı kayıt kotasını tüketmesi önlendi. Bu kontroller, bütün olası veri/ekran durumlarında evrensel görsel kabul iddiası değildir; kullanıcının gördüğü başka bölge ayrıca ekran görüntüsüyle doğrulanmalıdır.
- Ek görseller aynı review klasöründe: `store-editor-light.png`, `store-editor-dark.png`, `trendyol-form-light.png`, `trendyol-form-dark.png`, `parasut-form-light.png`, `parasut-form-dark.png`, `catalog-import-light.png`, `catalog-import-dark.png`.

## Kaynakların tamamında tema sahipliği

- İlk envanter: 1.449 native/HTML kontrol kullanımı; **147 eski görünüm deklarasyonu**, **198 eski intrinsic ölçü/etkileşim deklarasyonu**, **561 eski token kullanımı**. Bunlar sadece açık ekranların görüntüsünden değil CSS ve JSX AST'lerinden bulundu.
- Bildirim menüsü, aramalı seçim popover'ı, paket fiyatı radioları, eski sekmeler, HTML eylem düğmeleri ve koşullu stiller temizlendi. Native görünüm HeroUI'dedir; özel yerleşim `structure.css` içinde tek yerde toplanıp yinelenen kurallar birleştirildi.
- Artık referansı bulunmayan eski sipariş/ürün editörlerinden **64 seçici** kaldırıldı. Dinamik kategori sürükleme durumları gibi hâlâ kullanılan seçiciler tutuldu.
- Eski palet takma adları kaldırıldı. Kabuk, grafikler ve içerik doğrudan `--foreground`, `--background`, `--accent`, `--separator`, `--surface-shadow` gibi HeroUI token'larını okur. Ürün görselinin nötr zemini ve manuel kanal ikonu da temayı takip eder.
- `scripts/theme-contract.mjs`: bütün CSS/JSX kaynaklarının denetimi; native görünüm için kaynak düzeyinde hata. `build` ve `lint` bu kontrolü içerir. `tests/theme-contract.test.ts` görünmeyen durum kurallarının yakalandığını, meşru yerleşim/marka/çıktı istisnalarını ve adlandırılmış tema export'unu doğrular.
- `scripts/apply-theme.mjs`: Theme Builder dosyasını bir komutla doğrulayıp tek tema girişine aktarır. Kendi açık/koyu adları olan export'larda modlar merkezi olarak uyarlanır. Geçersiz veya bileşen stilleri içeren dosya hedefin üzerine yazılmaz.
- Varsayılan palete/köşeye kilitli tarayıcı beklentileri kaldırıldı. Native referans karşılaştırması yanında ikinci Ocean teması, yazı ailesi/köşe/kenarlık/gölge değişikliğiyle açık ve koyu görünümde doğrulanır. Bildirim/hesap menüleri, aramalı ürün seçimi ve paket fiyatı adımı da açılarak kontrol edilir.
- Son kaynak kontrolü **13 CSS dosyası ve 1.510 kontrol kullanımında sıfır ihlal** verdi. Derleme, TypeScript, lint, format ve **269 test / 38 dosya** geçti. Geniş tarayıcı koşusunda 30 senaryo geçti; iki yeni tema senaryosunun paket fikstüründeki tek adet nedeniyle durması, en az iki adetlik geçerli girdiyle düzeltildi. Ardından varsayılan ve alternatif temanın altı testi birlikte geçti.
- Görsel incelemede native butonun tüm SVG'leri ikon boyutuna düşürmesi, POS ürün çizimlerini de küçültüyordu. Ürün çizimlerinin frame boyutunu koruyan ortak yerleşim kuralı eklendi; native buton skin'i değiştirilmedi. POS ürün kartlarının bütün çizimleri için boyut regresyonu geçti.
- Ürün/kanal görsel çerçevelerinin köşeleri de tema ölçeğine bağlandı. Ocean testinin ek sıfır-köşe adımında bütün ürün çerçeveleri yalnız `--radius` / `--field-radius` değişimiyle kare oldu; açık/koyu alternatif tema testleri son derlemede geçti.

## Arama sonuçları ve nav başlığı düzeltmesi

- Kullanıcının ekran görüntüsündeki arama hatası yeniden üretildi: 400 px kullanılabilir alanda ilk sonuç yalnız 162 px genişliğindeydi. İki satırlı içerik, normal düğmenin sabit yüksekliğine sıkışıyordu.
- Arama `Autocomplete.Filter` + `SearchField` + `Menu.Item` + `Label/Description` bileşimine geçti. İkon, alanın native ikon slotundadır. Kaydırma sınırı menünün dış kapsayıcısındadır; satırlar flex ile küçülmez ve uzun başlıklar kendi satırları içinde kırılır.
- Native ok tuşu/Enter gezinmesi, aramayı temizleme ve sonuçsuz durum doğrulandı. Komut penceresinde tek Escape kapanışı korunur; SearchField'ın ilk Escape'i yalnız metni temizlemek için tüketmesi bu pencerede önlenir.
- HeroUI sürümü veya seçilen tema değişmedi. Nav bölüm başlıklarının tıklanabilir/tıklanamaz türlerde 14/16 px'e ayrılması giderildi; ikisi de native `header` tipografisini kullanır. Menü bağlantıları native düğme stillerini kullanmaya devam eder.
- `e2e/command-palette.spec.ts` genişlik, metnin satır sınırları, uzun ad, boş sonuç, temizleme, klavye ve başlık tutarlılığını 1440/440 px ile açık/koyu görünümde denetler. Yeni test önce hatayı tekrar üretti; çalışma alanı/seçici regresyonlarıyla birlikte 9 test geçti. Ardından genişletilen boş sonuç kontrolleri de geçti; mevcut ve alternatif tema kontrolleri başarılıdır.
- Native referans karşılaştırması artık `:focus`, `:focus-visible`, `:focus-within` ve `:has(input:focus)` durumlarını ayrı referans işaretleriyle taşır. Böylece odak halkası, sahte bir CSS çakışması olarak raporlanmaz.

## Onaylanan görsel iyileştirme ve hareket

Kullanıcı; Supsem'in tanıdık menü, ekran, form ve tablo akışları korunarak yazı hiyerarşisi, kart iç boşlukları, dashboard oranları ve ortak görsel vurguların iyileştirilmesini onayladı. Animasyonların da önemli olduğunu ayrıca belirtti.

- `Panel` artık normal kartlarda HeroUI'nin native padding/gap değerlerini kullanır. Tam genişlikte tablo/POS yüzeyleri açık `flush` seçeneğiyle tanımlanır. Form ve özet kartlarındaki eski ikinci iç padding'ler temizlenir; başlıklar ortak native tipografiyle gösterilir.
- Sayfa başlıkları daha ölçülü; ortak `Metric` kartları daha kompakt sayı/metin oranı ve native durum `Chip` bileşenleri kullanır. Tutarlar doğrudan son değerleriyle gösterilir.
- Dashboard'da satış grafiği/kanal kartları dengelenir; bütün kanallar aynı kartta korunur. Grafik, kanal ve ürün yerleşimleri `src/styles/dashboard.css` üzerinden tema değişkenleriyle beslenir. Öncelikler native kart ve durum etiketleriyle gösterilir.
- `src/lib/motion.ts`, ortak giriş (280 ms), etkileşim (140 ms), bölüm geçişi (220 ms) ve grafik çizimi (600 ms) ritmini tanımlar. Kartlar kısa ve sınırlı kademeyle görünür; aynı verinin tekrar çizilmesi kart girişini yeniden başlatmaz.
- `MotionConfig reducedMotion="user"` korunur. Kart/sayfa/sihirbaz girişleri ve grafik çizimi azaltılmış hareket tercihinde doğrudan son durumuna geçer; menü açılış/kapanışında yükseklik animasyonu da kapatılır. Bildirimler için kısa, sönümlü yay geçişi kullanılır.
- `e2e/dashboard-polish.spec.ts` kart boşluk/oranlarını, dokuz kanalın görünürlüğünü, dönem değişiminde bugünkü KPI'ların sabit kalmasını, mobil yerleşimi ve gerçek animasyon karelerini kontrol eder. Finansal değerlerin animasyon için saydırılmadığı ve azaltılmış hareket tercihinin uygulandığı ayrıca denetlenir.

Animasyon kaynakları: [MotionConfig](https://motion.dev/docs/react-motion-config), [Reduced Motion](https://motion.dev/docs/react-accessibility). Seçilen HeroUI paleti aynı tek tema girişinden gelir.

Doğrulama: KPI kartları yaklaşık 146 → 118 px; ana grafik/kanal kartları 557 → 426 px oldu. Başlıklar, kart boşlukları, bütün kanallar, dönem seçimi ve mobil taşma kontrolü geçti. Normal harekette ara animasyon kareleri gözlendi; azaltılmış harekette aynı içerik doğrudan son durumunda gösterildi. Native tema ve alternatif tema kontrolleri başarılıdır.

38 tarayıcı senaryosunun genel koşusunda 37 test geçti. İçerik güncelleme testinin 30 saniyelik sınırı, 20 saniyelik kuyruk kontrolü ve çalışma alanı polling turuyla çakıştı: izde sunucu `applied` sonucunu 14:21:49'da üretmiş, arayüz 14:21:54'te — test sınırının hemen ardından — almıştı. Test beklemesi 45 saniyeye çıkarıldı; aynı yayın/içerik akışı odaklı koşuda geçti. Üretim kuyruk aralıkları değiştirilmedi. TypeScript, arayüz/sunucu derlemesi, lint, format ve beş tema sözleşmesi testi geçti.

Görseller ve hareketli önizleme: `C:\Users\hub\AppData\Local\Temp\opencode\pazarhub-polish-review\` (`dashboard-before.png`, `dashboard-after.png`, `dashboard-dark.png`, `dashboard-mobile-dark.png`, `dashboard-motion.webm`).

## Daraltılabilir sol menü ve hafif header düzenlemesi

- Header'ın soluna native ikon düğmesi eklendi. Masaüstü menü 228/211 px ile 72 px ikon şeridi arasında geçiş yapar; içerik aynı ritimde genişler. Azaltılmış hareket tercihinde genişlik geçişi kapalıdır.
- Dar görünümde ikonlara klavye/hover açıklaması gelir. Tanımlamalar ve Stok aynı alt hedefleri native sağa açılan menüde sunar; seçili alt sayfa işaretlenir. Muhasebe gibi normalde katlanmış bölümler de dar görünümde erişilebilir kalır; genişletince önceki bölüm tercihleri geri gelir.
- Çalışma alanı seçicisinin başharfi ve tam erişilebilir adı korunur. Header yüksekliği ve hizaları sadeleştirildi; dar ekranlarda E-Ticaret/Perakende ikonları açıklama balonlarıyla kullanılır.
- Tercih, iş belgesinden bağımsız `pazarhub.ui.sidebar.compact.v1` tarayıcı ayarıdır. Mobil eşik (880 px) tek davranışla eşleştirildi; mobilde tam menü açılır, masaüstüne dönünce dar görünüm tercihi geri gelir.
- `e2e/sidebar.spec.ts`: açık/koyu, hatırlama, bütün hedeflerin erişimi, açıklama balonları, alt menü seçimi/Escape odağı, mobil geçiş ve sidebar/içerik animasyonunun birlikte hareket etmesi doğrulandı. Mevcut çalışma alanı, arama ve firma seçicisi regresyonları da geçti.
- İnceleme görselleri `C:\Users\hub\AppData\Local\Temp\opencode\pazarhub-sidebar-review\` altındadır.

## Header breadcrumbs ve açılır genel arama

- Header'da native `Breadcrumbs`, etiketli bir gezinme alanı içinde kullanılır. Ürün adı, sipariş numarası ve fatura numarası mevcut kayıttan gelir; yeni ürün/paket/sipariş/fatura ve düzenleme rotaları ayrı tanınır. Üst adımlar gerçek bağlantılardır; `RouterProvider` ile sayfa yenilenmeden gezinilir. Perakende stok adımları kendi çalışma alanına döner.
- Sidebar, arama ve breadcrumb etiketleri ortak `navigation.ts` tanımlarından yararlanır. Header'ın uzun metinleri ellipsis ile sığar; tam ad erişilebilir etikette ve başlıkta bulunur. 680 px ve altında son iki adım gösterilir.
- Genel arama geniş ekranda düğmenin altına bağlı native `Popover` içinde, 680 px ve altında mevcut mobil `Dialog` içinde açılır. Aynı `Autocomplete.Filter`, `SearchField` ve sonuç menüsü iki yerleşimde paylaşılır; ekran genişliği değişince arama metni korunur.
- Ctrl/⌘+K, ok tuşları, Enter, temizleme ve tek Escape kapanışı desteklenir. Dışarı tıklama paneli kapatır. Açılır panel yeniden konumlanırken odak kapsamı yeniden kurulabildiğinden, ilk açılış odağı ayrıca saklanır; kapanışta önceki alana dönülür.
- Native açılış animasyonu gerçek kare örneklemesinde görüldü; azaltılmış hareket tercihinde ara animasyon karesi oluşmadı. Yeni bileşenlerin görünümü merkezi HeroUI temasından gelir.
- `e2e/header-breadcrumbs.spec.ts`: kayıt/oluşturma/düzenleme rotaları, üst bağlantılar, SPA geri gezinmesi, 360–1440 px arası taşma ve native görünüm. `e2e/command-palette.spec.ts`: düğmeye bağlı yerleşim, mobil pencere, açık panelde ekran değişimi, ürün stok koduyla arama, boş sonuç, dışarı tıklama ve klavye odağı.
- Görseller: `C:\Users\hub\AppData\Local\Temp\opencode\pazarhub-header-review\` (`breadcrumbs-light.png`, `search-dropdown-light.png`, `search-dropdown-dark.png`, `breadcrumbs-mobile.png`, `search-mobile.png`).
- Son derlemede dört arama/breadcrumb ve iki alternatif tema senaryosu birlikte geçti. Sidebar, firma seçicisi ve mevcut çalışma alanı akışlarının 11 regresyonu önceki hedefli koşuda geçti. TypeScript, arayüz/sunucu derlemeleri, lint, tema sözleşmesi ve format kontrolü başarılıdır.

## Doğrudan hızlı arama, yüzey varyantları ve ikon şeridi

Kullanıcının sonraki düzeltmesiyle genel arama, düğme/pencere bileşiminden doğrudan yazılan **“Ara…”** alanına geçti.

- `HeaderSearch`: HeroUI `ComboBox` + `Input` + `ListBox`. Sonuç genişliği React Aria'nın ölçtüğü `--trigger-width` değeridir; alan ve panel aynı genişliktedir. Mobilde arama header'ın ikinci satırına yerleşir. Sayfa/ürün/sipariş araması, ürün stok kodu ve barkod eşleşmesi, Ctrl/⌘+K, oklar, Enter, Escape ve temizleme desteklenir. Inline hızlı aramada Escape sonuçları kapatır ve odağı aynı arama alanında bırakır; önceki sayfa filtresi korunur.
- `QuickSearchField`, HeroUI'nin ilk gizli koleksiyon geçişinde henüz olmayan ComboBox durumunu bekler. Özel açılma durumu veya ikinci arama alanı tutulmaz; native ComboBox davranışı kullanılır.
- Hızlı arama yalnız sayfa yolu değiştiğinde yenilenir. `location.key` ile yeniden kurulması, liste filtresinin query-string güncellemesi tamamlandığında metin/odağı kaybettiriyordu; `location.pathname` anahtarıyla bu neden giderildi. Uzun ürün adıyla mobil incelemede görülen dashboard satır taşması da küçülebilir grid sütunuyla düzeltildi.
- HeroUI'nin resmi [Input / In Surface](https://heroui.com/docs/react/components/input#in-surface) örneği kart/surface içinde `secondary` önerir. `useFieldVariant` native `SurfaceContext` üzerinden beyaz/default kartlarda `secondary`, sayfa ve gri yüzeylerde `primary` seçer. Ortak `Field`, `MoneyField`, `SearchBox`, `SearchSelect` ve seçim düğmeleri buna uyar. Seçim düğmesinde mevcut menü davranışı native `select--secondary` skin'iyle birlikte kullanılır.
- `SearchBox` artık native `SearchField` bileşimidir. Tarih/dosya/metin alanlarının HTML sürümleri de HeroUI'nin gerçek `input--secondary` / `textarea--secondary` sınıflarını kullanır. Giriş formunun beyaz yüzeyi ve varyant düzenleyicisinin gri bölümleri native yüzey bağlamını sağlar.
- Gri varyant bölümlerindeki yardımcı işlemler native `outline` kullanır. E‑Ticaret/Perakende seçili düğmesi native `primary`, diğeri `ghost` varyantındadır. Mobilde liste araçları satıra sığmadığında sarılır.
- Dar menüde 48 px düğme / 47 px içerik uyuşmazlığı giderildi: 36 px ikon düğmeleri ortalanır; kenar, kaydırma çubuğu ve odak halkasına yer ayrılır. Açıklamalar şeridin sağından açılır. Sürüklemeli boyutlandırma yerine iki kademeli kullanım önerildi.
- Açık temanın metin açıklığı kullanıcının istediği küçük yumuşatma için **%21,03 → %25** oldu; `--default-foreground` aynı merkeze bağlandı. Değişiklik yalnız `heroui-theme.css` içindedir; yazı kalınlıklarına tek tek müdahale edilmez.
- İnceleme görselleri: `C:\Users\hub\AppData\Local\Temp\opencode\pazarhub-controls-review\` (`quick-search-desktop.png`, `quick-search-mobile.png`, `fields-secondary-after.png`, `fields-secondary-dark.png`, `native-field-and-button-variants.png`, `rail-after.png`).
- Doğrulama: hedefli koşularda 23 farklı tarayıcı senaryosu geçti (hızlı arama, sidebar, breadcrumb, mevcut iş akışları, firma seçicisi, açık/koyu ve alternatif tema). Son hızlı arama koşusu 2/2 başarılıdır; query-string güncellenirken metin/odak korunması da denetlenir. Native animasyonda 8 ara kare, azaltılmış harekette 0 ara kare gözlendi. Beş tema sözleşmesi testi, TypeScript, derlemeler, lint ve format kontrolü geçti; son kaynak denetimi 15 CSS dosyası / 1.557 kontrol kullanımında sıfır ihlal verdi.

## Native çalışma alanı switch'i ve arama köşeleri — 27 Ekim 2026

- Kullanıcının işaret ettiği switch uyumsuzluğu: özel dış kapsayıcı `--radius-xl` (12 px), iç HeroUI Button `--radius-3xl` (24 px) kullanıyordu. Dış zemin/kenarlık/padding/köşe ve butona özel mobil kurallar kaldırıldı.
- Switch artık native `ToggleButtonGroup` + `ToggleButton` bileşimidir. Birleşik köşeler, nötr/seçili mavi tonlar, inset odak halkası ve ikon ölçüleri HeroUI'den gelir; ikinci bir buton skin'i yoktur. `selectionMode="single"` ve `disallowEmptySelection` kullanılır. Seçim rotadan türetilir; klavye, fare ve tarayıcı geri gezinmesi aynı seçimi gösterir. Seçili moda tekrar basmak mevcut alt sayfadan ana sayfaya atlatmaz.
- Arama alanında aynı iç/dış kapsayıcı hatası yoktur: native Input `--field-radius` (12 px), ayrı ComboBox sonuç yüzeyi `min(32px, --radius-3xl)` (24 px) kullanır. Altındaki panel kutunun içinde değildir; genişlikleri eşleşir, aralarında 6 px boşluk vardır. Arama stiline veya davranışına müdahale edilmedi.
- `e2e/workspace-mode.spec.ts`: birleşim köşeleri, dış özel kutunun yokluğu, tekli seçim, klavye/fare/geri gezinme, 1440/1100/390 px görünüm ve aramanın native referans karşılaştırması. Son ortak koşuda 12 tarayıcı testi geçti; TypeScript/build, lint, format ve beş tema sözleşmesi testi başarılıdır.
- Header/arama görselleri test çıktısında `native-switch-{light,dark}-{1440,1100,390}.png` ve `native-search-{light,dark}.png` adlarıyla saklanır.

### Kullanıcı tercihi: dış çerçeveli pill görünümü

Birleşik native butonlar, dış kutu kaldırılınca arama alanına göre küçük kaldığı ve önceki pill hissini kaybettiği için kullanıcı bu görünümü istemedi.

- `ToggleButtonGroup` artık native `isDetached` varyantındadır; her iki parça da tam yuvarlaktır. Dış yüzey HeroUI `Surface variant="secondary"` ve tema ölçekli `rounded-3xl` kullanır. Butonlar native `ghost` ile dış zemine karışır; seçili parça native mavi tonlu dolgusunu korur.
- Yalnız yerleşim boşluğu `structure.css` içinde `--spacing × 0.5` olarak tanımlanır. Dış/iç köşeler aynı native radius ölçeğinden gelir; önceki 12/24 px özel dış-kutu uyuşmazlığı geri getirilmedi.
- Toplam switch yüksekliği aramayla eşleşir: masaüstünde 36 px, mobilde 40 px. Arama alanına, palete ve yönlendirme düzenine müdahale edilmedi.
- Açık/koyu tema, 1440/1100/390 px geometrisi, klavye/fare/geri gezinme, arama ve sidebar regresyonlarının 8 testi birlikte geçti. Build/TypeScript, lint, merkezi tema ve format kontrolleri başarılıdır. Güncel görseller `pill-switch-{light,dark}-{1440,1100,390}.png` adlarıyla test çıktısındadır.

### Pill'in gerçek kayma animasyonu

- Kullanıcı, yalnız seçili rengin değişmesini değil pill'in yer değiştirmesini istedi. `ToggleButtonGroup` altyapısının kendi `SelectionIndicator` bileşeni eklendi; seçili dolgu 220 ms içinde diğer seçeneğin konumuna ve genişliğine geçer. Etiketler, ikonlar ve tıklama alanları yerinde kalır.
- Dolgu, native `toggle-button--ghost` seçili görünümünden gelir. Gerçek kontrolün seçili zemini transparan utility ile yalnız bu hareketli katmana devredilir; renk/köşe/gölge yeniden tanımlanmaz. Yerleşim ve geçiş özellikleri `structure.css` içindedir; azaltılmış harekette `transition: none` uygulanır.
- Masaüstü ve mobil gerçek kare örneklemesinde ara konumlar gözlendi; azaltılmış harekette ara konum yoktur. Etiket/ikon konumunun sabit kaldığı, tek pill bulunduğu ve son konumun seçili kontrolle hizalandığı denetlendi.
- Son ortak koşuda açık/koyu ve alternatif tema, arama, sidebar ve animasyon dahil 12 tarayıcı testi geçti. TypeScript/build, lint, format ve beş tema sözleşmesi testi başarılıdır.

## Perakende ana ekranı kartlarının hafif küçültülmesi

- Kullanıcının isteğiyle yalnız altı hızlı işlem kartının boşlukları/ikon alanları sıkılaştırıldı. Masaüstü kart padding'i 24 → 20 px, ikon alanı 45 → 40 px oldu; ikon altı, açıklama ve alt bağlantı boşlukları azaltıldı. Açıklamalar, hedefler, 3/2 sütun düzeni, renkler ve hover davranışı korunur.
- 1440 px ekranda kart yüksekliği yaklaşık **260 → 223 px** (%14,4); iki satırlı kart alanı **539 → 462 px** oldu. 390 px mobilde kartlar **225 → 209 px**; üç satırlı alan **696 → 648 px**. Yeni boşluklar merkezi `--spacing` ölçeğini kullanır; sabit yükseklik veya metin kırpma yoktur.
- `e2e/retail-home.spec.ts` açık/koyu görünümde 1440/1100/390/360 px için kart ölçülerini, açıklama/alt satırların sığmasını, altı hedefin korunmasını ve klavyeyle Yeni satış'a geçişi denetler. Mevcut POS stok/kasa, sipariş/fatura ve mobil akışlarla birlikte 8 tarayıcı testi geçti. TypeScript/build, lint ve tema sözleşmesi başarılıdır.
- Önce/sonra görselleri `C:\Users\hub\AppData\Local\Temp\opencode\pazarhub-retail-home-review\` altında `before-{1440,1100,390}.png` / `after-{1440,1100,390}.png` olarak saklanır.
