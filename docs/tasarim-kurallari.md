# Tasarım kuralları

Görünüm üç katmandan gelir. Her katmanın tek sahibi vardır ve `npm run check:theme` (build ve lint içinde) kuralları denetler. Kurallar insan ya da yapay zekâ fark etmeksizin herkes için aynıdır.

| Katman              | Dosya                         | Ne tanımlar                                                                                                                  |
| ------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Tema                | `src/styles/heroui-theme.css` | Renkler, köşe, gölge, yazı ailesi. Yalnız HeroUI değişkenleri. Değişimi: [HeroUI tema değiştirme](heroui-tema-degistirme.md) |
| Uygulama token'ları | `src/styles/tokens.css`       | Yazı rolleri, 4 kalınlık, harf aralığı, satır yüksekliği, boşluk ritmi (`--app-*`)                                           |
| Bileşen görünümü    | `@heroui/styles`              | Buton, kart, alan, tablo, menü… Uygulama CSS'i bunları ezmez                                                                 |

Sayfa CSS'i (`src/styles/*.css`) yalnız yerleşim yazar ve değerleri token'lardan alır.

## Yazı

- **Boyut:** `var(--text-xs|sm|base|lg|xl|2xl|3xl)` ya da rol token'ı (`--app-type-title`, `--app-type-body`…). Sabit `px`/`rem` reddedilir.
- **Kalınlık:** yalnız `var(--app-weight-regular|medium|semibold|bold)` (400/500/600/700). Gövde 400, etiket ve satır başlığı 500, kart/sayfa başlığı ve önemli rakam 600, marka yazısı 700.
- **Harf aralığı:** `0` ya da `var(--app-tracking-display|tight|snug|caps)`. Büyük başlık `tight`, küçük başlık `snug`, BÜYÜK HARF etiket `caps`.
- **Satır yüksekliği:** `1` ya da `var(--app-leading-display|tight|normal|relaxed)`. Tek satırlık başlık `tight`, arayüz metni `normal`, açıklama paragrafı `relaxed`.
- **Yazı ailesi:** `var(--font-sans)` / `var(--font-mono)`. `font:` kısaltması kullanılmaz.

## Boşluk

- `padding`, `margin`, `gap` değerleri `var(--app-space-N)` (N × 4 px) ya da `calc(var(--spacing) * n)` olmalı.
- Mevcut sabit `px` boşluklar `scripts/design-baseline.json` içinde dosya başına sayılır. **Bu sayı yalnız azalabilir;** yeni CSS dosyası sıfırdan başlar. Bir dosyayı temizledikten sonra `npm run check:theme -- --update-baseline` ile mandalı düşürün.
- Kenarlık kalınlığı, ikon/kontrol boyutu gibi ölçüler boşluk sayılmaz.

### Yerleşim ritmi

Sayfalar arası tutarlılık bu değişkenlerden gelir; aynı ilişki için başka değer yazılmaz.

| Token                 | Değer | Kullanım                                                                                                                          |
| --------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--app-page-gutter`   | 32 px | Ana içerik ve üst çubuğun yan boşluğu (ikisi hizalı)                                                                              |
| `--app-page-top`      | 24 px | Üst çubuk → sayfa başlığı                                                                                                         |
| `--app-header-gap`    | 24 px | Sayfa başlığı → ilk içerik                                                                                                        |
| `--app-section-gap`   | 16 px | Kartlar, ızgaralar ve sayfa bölümleri arası                                                                                       |
| `--app-panel-inset`   | 20 px | Tam genişlik (flush) panelde başlık, araç çubuğu, filtre satırı, tablonun ilk/son hücresi ve sayfalama — hepsi aynı dikey çizgide |
| `--app-cell-inset`    | 12 px | Tablo hücreleri arası yatay iç boşluk                                                                                             |
| `--app-sidebar-inset` | 12 px | Sol menü kenar boşluğu                                                                                                            |
| `--app-shell-inset`   | 12 px | Sol menü kartı ve başlık kartının pencere kenarına uzaklığı                                                                       |
| `--app-chrome-height` | 56 px | Başlık kartının yüksekliği. Sol menüde logonun üstü ve solu 24 px, alttaki ilk bölüm başlığına uzaklığı da yaklaşık 24 px         |
| `--app-branch-indent` | 28 px | Sol menü grubunun alt sayfaları; grup ikonundan çıkan dal bu boşluğu doldurur                                                     |

### Hareket

- JS animasyonları `src/lib/motion.ts` içindeki `motionTransitions` geçişlerini kullanır. CSS geçişleri aynı eğri için `var(--app-ease-out)` kullanır; çizgi çizme süresi `var(--app-duration-draw)` (400 ms).
- `prefers-reduced-motion: reduce` seçiliyse geçiş kapatılır (motion tarafında `useReducedMotion`).
- **Sol menü grupları** (`SidebarGroup`): alt sayfalar grup ikonunun altından dallanır. Çizgiler satırlar ölçülerek çizilir; satır yüksekliği veya ikon boyutu değişince elle sayı güncellemek gerekmez. Bulunduğunuz sayfanın dalı vurgu renginde çizilir ve sayfa değişince yeni sayfaya kayar. Grup kapalıyken vurgu grubun kendisine geçer. Bölüm başlıklarında dal yoktur; denendi, beğenilmedi.

## Sayfa kalıpları

- **Kabuk:** Sol menü ve başlıktaki kontroller, ana sayfa panelleri gibi HeroUI `Card` içindedir (`.sidebar-card`, `.topbar-right`); görünüm karttan gelir, CSS yalnız yerleşimi yazar. Başlık çubuğu yoktur: menü daraltma düğmesi ve sayfa yolu gri zeminde, içerikle aynı sol çizgidedir. Sol menünün üstünde yalnız logo durur. Çalışma alanı seçici ve bağlantı durumu (örnek/sunucu) kartın en altındadır; menüsü yukarı doğru açılır ve sürüm numarasını başlıkta gösterir.

- **Ayarlar ve profil:** Çalışma alanı ayarları `/settings/:section` adresinde, solda dikey HeroUI `Tabs` (mobilde yatay) ile bölümlenir. Yeni bölüm `SettingsPage` içindeki `sections` listesine eklenir. Çalışma alanına ait bilgiler (işletme bilgileri) komutla tüm ekibe kaydedilir. Kişisel tercihler (tema, yoğunluk, bildirimler) üyelik tercihi olarak yalnız o kullanıcıya kaydedilir; bunlar `/profile` ya da Bildirimler bölümündedir.
- **Kişi avatarı:** `UserAvatar`. Çerçeve HeroUI `Avatar`, içi DiceBear "Glass" (CC0) ile tarayıcıda üretilir. Aynı kimlik (kullanıcı id) hep aynı görseli verir; görsel yüklenene kadar baş harfler görünür. Başka bir yerde avatar gerekirse yeni stil eklemeden bunu kullanın.
- **Sayfa başlığı:** `PageHeader` — başlık, açıklama, sağda eylemler. Detay sayfalarında `back={{ to, label, context }}` listeye dönüş bağlantısını ve kayıt kodunu başlığın üstünde gösterir; sayfaya ayrı breadcrumb yazılmaz.
- **Panel:** `Panel` — başlık/açıklama/eylem başlığı ve içerik. Tablo veya liste taşıyan panel `flush` kullanır; iç satırlar `--app-panel-inset` ile hizalanır.
- **Liste:** `Panel flush` içinde araç çubuğu (`.list-toolbar` ya da sayfanın araç çubuğu), filtre satırı (`FilterTabs`), `DataTable`, sayfalama. `DataTable` hücreleri panelin kenar çizgisine kendiliğinden hizalanır.

## Renk ve bileşen

- Renk yalnız tema değişkenlerinden: `var(--foreground)`, `var(--muted)`, `var(--accent)`, `var(--surface)`, `var(--border)`… Sabit renk yalnız `print.css` kağıt çıktısında ve `content.css` marka/ürün çiziminde.
- HeroUI bileşeninin görünümünü (renk, kenarlık, gölge, yazı) uygulama CSS'inden ezmeyin; bileşenin `variant`/`size` özelliklerini kullanın. Bileşen yerleşimi istisnaları yalnız `structure.css`'te.
- Yeni değişken gerekiyorsa `tokens.css`'e `--app-` önekiyle ekleyin; sayfa dosyasında değişken tanımlamayın.

## Kontroller

```sh
npm run check:theme   # tema + ölçek + boşluk mandalı
npm test              # tests/theme-contract.test.ts kuralları sınar
```
