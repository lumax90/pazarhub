# Pazarhub

React + Vite + HeroUI 3.2.6 + Motion tabanlı pazaryeri operasyon paneli. **Pazarhub geçici çalışma adıdır.**

## Çalıştırma

Node.js 24 LTS ile:

```sh
npm ci
npm run dev:full
```

Arayüz: **http://localhost:5173** · API: **http://127.0.0.1:3001**.

Windows'ta taşınabilir Node ortamını da bulan yardımcı:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\project.ps1 -Task dev:full
```

Yerel geliştirmede PostgreSQL adresi verilmezse `.data/postgres` altında kalıcı PGlite kullanılır. `DATABASE_URL` verilirse PostgreSQL kullanılır. `.env.example` ayar örneğidir. Ayrı worker için PostgreSQL gerekir; yerel modda worker API sürecinde çalışır.

## Çalışan alanlar

- Sunucu oturumu, firma izolasyonu, beş rol, davet ve parola yönetimi.
- Ürün/varyant/paket kartları, renkli varyant görselleri, toplu düzenleme, altı kapsamlı mağaza marj kuralları ve tanım eşlemeleri.
- Sipariş, çok depoda rezervasyon/stok uygulama, TRY/USD/EUR/GBP ve KDV giriş esası, yazdırıldı takibi, fatura ve kasa kaydı.
- Supsem'in doğrulanan fatura akışı: siparişsiz fatura oluşturma, tam sayfa düzenleme/detay, KDV hariç kalem, vade/döviz, depo ve tahsilat; yerel iptal/geri alma.
- Depolar, çift taraflı transfer, çakışma kontrollü sayım ve hareket defteri.
- Perakende satış, indirim, bölünmüş/kısmi tahsilat, veresiye ve kısmi iade.
- Gider/ürün alışı, ödeme, virman, cari fiş ve müşteri bakiyeleri.
- Uzak katalog havuzu, ürün/sipariş kalemi eşleme, kuyruk, tekrar deneme ve sonuç takibi.
- Yedi pazaryerinde yeni ürün, Amazon Türkiye'de mevcut ASIN'e teklif; grup önizlemesi, kategori/özellik eşlemesi ve sağlayıcı onayı.
- Desteklenen sağlayıcılarda mevcut ilan içeriği, soru/yanıt, kanıtlı iade kararı, paket/etiket/kargo bildirimi ve kalem uzlaştırması.
- Trendyol ödeme emri–kasa mutabakatı; Hepsiburada kayıt bazlı muhasebe; PttAVM varyant stokları ve ToptanTR Adet/Paket/Koli ortak stok.
- Paraşüt fatura/kur/kalem doğrulaması, PDF saklama ve belirsiz fatura/taşıyıcı sonuçlarını tekrar oluşturmadan uzlaştırma.
- CSV/XML dosya aktarımı; alan eşleme, model/varyant gruplama, SKU güncelleme ve depo stoku için atomik önizleme/uygulama.
- Şifreli API bilgileri; sekiz pazaryeri, Paraşüt ve dört kargo sağlayıcısı için adaptör kodu.
- Mobil gezinme, açık/koyu/sistem tema, yoğunluk ayarı ve `Ctrl/⌘ + K` arama.

**Durum:** Çekirdek akışlar yerelde kodlandı; son birim/alan/sunucu/adaptör ve tema sözleşmesi koşusunda **269 test (38 dosya)** geçti. Tarayıcı kabulü, native tema ve alternatif tema geçişini de kapsar; koşu ayrıntıları [yayına hazırlık](docs/yayin-hazirligi.md) belgesindedir. Gerçek hesap, şirket geçişi ve Coolify staging kabulü açıktır.

Giriş ekranındaki **Örnek ekranları incele** seçeneği ayrı tarayıcı demosunu açar. Demo kayıtları `localStorage` içinde, gerçek çalışma alanı kayıtları sunucuda tutulur. Demo sıfırlama gerçek verileri etkilemez.

## Kontroller

```sh
npm run lint
npm test
npm run build:all
npm run format:check
npx playwright install chromium
npm run test:e2e
```

Tarayıcı testleri önce üretim derlemesi alır. Demo akışları yanında ayrı bellek içi test veritabanıyla gerçek uygulama API'sine bağlı oturum, kalıcılık, davet, ürün yayınlama ve pazaryeri işlemleri sınanır. Sağlayıcı cevapları yerel sözleşme fikstürleridir; testler dış pazaryerlerine işlem göndermez.

## Yayın

`Dockerfile` ve `compose.yaml`: uygulama, PostgreSQL 18, worker ve günlük yedek servisi.

[Coolify kurulumu](docs/coolify-kurulum.md) · [Supsem karşılaştırması](docs/supsem-inceleme.md) · [Açık yayın maddeleri](docs/yayin-hazirligi.md)

## Yapı ve işlem modeli

```text
src/domain/           Ortak kuruş, stok, satış, iade ve muhasebe kuralları
src/app/              Oturum, sunucu/demoya erişim ve yönlendirme
src/components/       HeroUI tabanlı ortak iş bileşenleri
src/pages/            Çalışma ekranları
server/               Fastify API, oturum, şifreleme, migration ve işlemler
server/integrations/  Sağlayıcı adaptörleri ve HTTP/SOAP sınırları
server/publishing/    Kategori/özellik, yayın önizlemesi, gönderim ve onay
server/marketplace/   Sorular, iade kararları, finans kayıtları ve mutabakat
server/order-fulfillment/ Pazaryeri paket, etiket ve kargo işlemleri
server/listing-content/ Mevcut ürün içeriği ve alan onayı
server/catalog-import/ CSV/XML okuma, eşleme ve atomik katalog aktarımı
tests/                Alan kuralları, firma izolasyonu ve API sözleşme testleri
e2e/                  Tarayıcı iş akışları
scripts/              Yerel çalışma, derleme, sağlık kontrolü ve yedek
```

İş verisi firma başına JSONB çalışma belgesinde, komut makbuzları/bağlantılar/kuyruk/harici kayıtlar ayrı tablolardadır. Komutlar firma satır kilidi altında atomik uygulanır; tekrar istekte aynı makbuz döner. Kuyruk aynı bağlantıda eşzamanlı çağrıyı, aynı kayıtta da sırasız yazmayı önler. Sonucu belirsiz fatura/gönderi otomatik tekrar oluşturulmaz. Büyük katalog/sipariş hacmi için staging yük testi ve kayıt bazlı veri erişimi hâlâ gereklidir.

Temsili veri taşıma ve açılış bakiyesi deneyi: [geçiş provası](docs/supsem-gecis-provasi.md). Gerçek Supsem dışa aktarımıyla doğrulanmış otomatik geçiş aracı değildir.

## Tema değişimi

HeroUI Theme Builder'dan dışa aktarılan CSS tek komutla uygulanır:

```powershell
npm run theme:apply -- "tema.css"
```

Tema girişi `src/styles/heroui-theme.css` dosyasıdır. Yazı ölçeği ve boşluk token'ları `src/styles/tokens.css` içindedir; kurallar: [Tasarım kuralları](docs/tasarim-kurallari.md). `npm run check:theme`, eski görünüm kurallarının native bileşenlere sızmasını denetler; `build` ve `lint` sırasında da çalışır. Ayrıntılar: [HeroUI tema değiştirme](docs/heroui-tema-degistirme.md).
