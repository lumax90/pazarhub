# HeroUI temasını değiştirme

Uygulama HeroUI **v3.2.6** kullanır. Tema girişi `src/styles/heroui-theme.css` dosyasıdır.

## Bir tema uygulama

1. [HeroUI Theme Builder](https://heroui.com/en/themes) üzerinden temayı seçip CSS'ini dışa aktarın.
2. Proje dizininde çalıştırın:

   ```powershell
   npm run theme:apply -- "C:\indirilenler\tema.css"
   ```

Komut CSS değişkenlerini doğrular, varsa `ocean` / `ocean-dark` gibi adlandırılmış `color-scheme` bloklarını uygulamanın `light` / `dark` modlarına uyarlar ve **yalnız `src/styles/heroui-theme.css` dosyasını** günceller. Bileşenleri veya iş verisini değiştirmez. Vite açıkken değişiklik otomatik yüklenir.

Yazmadan doğrulamak için:

```powershell
npm run theme:apply -- "C:\indirilenler\tema.css" --check
```

Yeni tema ek bir font gerektiriyorsa font dosyasının/paketinin importu `src/styles.css` içindedir; seçilen yazı ailesi `--font-sans` üzerinden tanımlanır. Sistem fontlarında ek paket gerekmez.

## Tek tema kaynağı

- `heroui-theme.css`: yalnız tema değişkenleri ve açık/koyu modlar. Renk, font, köşe, alan kenarlığı ve gölge buradan gelir.
- `@heroui/styles`: buton, alan, menü, kart, tablo, radio ve diğer primitive'lerin görünümü ve etkileşim durumları.
- `structure.css`: uygulamaya gereken genişlik, hizalama, satır yoğunluğu, kaydırma ve responsive yerleşim. Bileşen görünümü tanımlanmaz.
- Diğer uygulama CSS'leri: kabuk ve iş içeriğinin yerleşimi; görsel değerler doğrudan HeroUI değişkenlerini kullanır. Eski `--text`, `--line`, `--blue-soft` gibi ikinci bir değişken katmanı yoktur.
- `content.css`: pazaryeri kimlik renkleri ve ürün görselleri. `print.css`: kağıt çıktısı.
- Açık/koyu tema önizlemeleri de aynı değişkenleri okur; önceki temanın sabit renklerini göstermez.

Ortak `Panel`, normal kullanımda HeroUI Card'ın kendi iç boşluğunu kullanır. Kenara kadar uzanan tablo/POS yüzeyi gerekiyorsa `flush` açıkça seçilir; bütün kartları sıfır padding'e zorlayan bir kural eklenmez. Sayfa başlığı, KPI ve kart başlığı ölçüleri ortak bileşenlerden gelir.

Hareket ritmi `src/lib/motion.ts` içindedir. Girişler kısa, kademeli ve işletim sisteminin azaltılmış hareket tercihine uyumludur. Tema CSS'ini değiştirmek animasyon için ayrıca bileşen düzenlemeyi gerektirmez. Finansal metinler animasyon boyunca gerçek son değerlerini taşır.

## Eski çakışmaların geri gelmesini önleme

```powershell
npm run check:theme
```

Bu kontrol `lint` ve `build` komutlarında otomatik çalışır. Bütün kaynak dosyalarını ve koşullu/template bileşen sınıflarını tarar; açılmamış bir pencereye ait kuralı da denetler.

- Native bileşenin rengini, köşesini, gölgesini, yazısını veya pseudo-element görünümünü uygulama CSS'iyle ezmek hata üretir.
- Tema dışında sabit renk, eski değişken takma adı veya tanımsız tema değişkeni hata üretir.
- Native bileşene satır içi görünüm veya `@apply` ile ikinci bir skin eklenmez; `variant`, `color`, `size` özellikleri kullanılır.
- Normal HTML düğmelerde de HeroUI'nin native CSS sınıfları kullanılır.
- Marka/kağıt istisnaları dosya geneline açık bir kaçış değildir; native bileşen kuralları bu dosyalarda da denetlenir.

`e2e/native-skin.ts`, tarayıcıda görünen primitive'leri aynı DOM/tema/durumdaki temiz HeroUI referansıyla karşılaştırır. Testler tek bir paletin hex değerlerine veya sabit köşesine bağlı değildir; yeni temada da çalışır.

`e2e/theme-switch.spec.ts`, HeroUI belgelerindeki Ocean örneğinden türetilen ikinci bir token dosyasıyla farklı font, renk, köşe, alan kenarlığı ve gölgeleri sınar. Üretimde kullanıcının seçtiği tema kalır; diğer tema yalnız test tarayıcısına yüklenir.

## Kaynaklar

- [HeroUI v3 Theming](https://heroui.com/docs/react/getting-started/theming)
- [HeroUI v3 Styling / BEM sınıfları](https://heroui.com/docs/react/getting-started/styling)
- [Theme Builder](https://heroui.com/en/themes)
