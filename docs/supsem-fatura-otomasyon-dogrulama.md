# Fatura zamanı, varsayılan hesap ve link otomasyonu

25 Ekim 2026. Yenilenen Supsem oturumunda E-Ticaret Ayarları → Siparişler, boş yeni Paraşüt bağlantısı formu ve mevcut Trendyol bağlantısının düzenleme formu incelendi. **Supsem'de bağlantı ekleme/test etme, varsayılan değiştirme, ayar kaydetme veya gerçek fatura gönderimi yapılmadı.** Sır alanlarının değerleri alınmadı; bu belge müşteri/hesap verisi içermez.

## Gözlenen kaynaklar

- `/dashboard/ecommerce-settings`: Sipariş faturası ne zaman kesilsin? → Kesilmesin (elle), Sipariş girilince, Onaylandığında, Kargoya verildiğinde, Teslim edildiğinde.
- `/dashboard/integrations/accounting/parasut`: ilk yeni bağlantı varsayılan; birden fazla Paraşüt hesabı ve ayrı “Varsayılan yap” işlemi. Yeni formda otomatik fatura zamanının tüm muhasebe bağlantıları için E-Ticaret Ayarları'ndan yönetildiği yazıyor.
- Aynı Paraşüt formunda otomatik resmileştirme ve resmileştirme gecikmesi, irsaliye/internet satışı, tahsilat ve ihracat alanları ayrı.
- `/dashboard/integrations/marketplaces/trendyol`: Fatura bağlantısını gönder anahtarı; resmileşmiş belgenin linkini paketle ilişkilendirir. Ayrıca 0–1440 dakika e-fatura e-postasını bekleme alanı bulunur; süre sonunda platformda fatura zaten varsa tekrar gönderilmemesi anlatılır.

## Bu turda uygulananlar

| Gözlenen akış | Uygulama ve sınırı |
|---|---|
| Firma genelinde beş fatura zamanı | E-Ticaret Ayarları → Siparişler'e eklendi. Yeni yerel ve açık pazaryeri siparişleri seçimle oluşturulur; uygun duruma ulaştığında bir kez yerel fatura oluşturulur. |
| Fatura ve stok aynı satıştan kaynaklanır | Fatura oluşturma ikinci stok hareketi yaratmaz. Sipariş onayı mevcut dondurulmuş reçete/depo dağılımını uygular; fatura aynı kaynak kalemlerden beslenir. |
| Varsayılan Paraşüt hesabı | İlk yeni hesap varsayılan olabilir; ayrı varsayılan değiştirme ve bağlantı formu seçimi eklendi. Firma başına tek varsayılan fatura hesabı DB kısıtıyla korunur. Varsayılan seçmek hesabı test etmez/etkinleştirmez. |
| Bağlı Paraşüt hesabına otomatik aktarım | Yeni bağımsız belge yalnız iç kayıt değilse; sipariş belgesi seçilen zamana ulaşmışsa etkin/test edilmiş uygun hesaba kalıcı iş açılır. Taslak/resmileştirme tercihi ve gecikme mevcut ayrı Paraşüt ayarıdır. |
| Mağazanın farklı muhasebe hesabı | Açık mağaza hesabı seçimi firma varsayılanından önceliklidir. Seçili veya varsayılan hesap kapalı/test edilmemişse başka firmanın hesabına tahminen geçilmez. Yerel belge kalır ve açık gönderim yapılabilir. |
| Fatura bağlantısını gönder | Destekleyen pazaryerlerinin bağlantı formuna ayrı anahtar eklendi. Paraşüt sonucundan ve elle bağlanan dış belgeden gelen otomatik link işleri buna uyar. Kapalıyken belge oluşturulabilir fakat otomatik link iletilmez. |
| Gönderilmemiş link işi | Anahtar kapatılınca henüz link yazması başlamamış otomatik queued/waiting işler iptal edilir. Her sağlayıcı çağrısından önce güncel anahtar tekrar kontrol edilir. Gönderilmiş belge geri çekilmiş sayılmaz; yanıtı belirsiz yazmanın işareti korunur. |

## Geçmişi ve yetkiyi koruma

- Fatura zamanı yeni siparişin `invoiceTiming` alanına kaydedilir. Firma varsayılanını değiştirmek eski siparişleri/faturaları yeniden kesmez. Eski kayıtlar mevcut onay-zamanı davranışını korur. Bu, otomatik geçmişe uygulama yapılmayan güvenli geçiş politikasıdır.
- Geçmiş/historik içe aktarım, iptal/iade, eşlenmemiş veya uzlaştırma bekleyen kaynak otomatik yeni mali belge üretmez. Açık siparişin yeni durumu içe alındığında, stok uzlaştırmasında ve uygun kalem uzlaştırmasında aynı tek-belge kuralı kullanılır.
- Onay/kargo/teslim durumunda stok işlemi tamamlanmamışsa veya sipariş senkron hatasındaysa otomatik fatura açılmaz. Sipariş-giriş zamanı seçili pending kayıtta rezervasyon yeterlidir; sonraki onay stok çıkışını yalnız bir kez uygular.
- İlk yeni bağlantının varsayılan olması ve mevcut hesabın kullanıcı tarafından seçilmesi farklıdır. Şema 11, var olan hesaplar arasında otomatik bir varsayılan atamaz. Eski mağazaların “Elle gönder” / “Onayda” tercihi korunur; yeni arayüzde “Firma fatura zamanını kullan” seçilebilir.
- Varsayılan değişikliği mevcut fatura/kuyruk işinin bağlı hesabını değiştirmez. Belge başka hesapta yeniden oluşturulmaz. Silinen/pasif varsayılanın yerine rastgele hesap seçilmez.
- Firma fatura zamanı `workspace.manage`, varsayılan hesap ve mağaza anahtarı `integrations.manage` ister. Hesap seçimi firma kilidi ve idempotency makbuzuyla atomiktir; başka firmanın bağlantısı seçilemez.
- İsteğe bağlı dış belge numarası boşken de link kaynak anahtarı JSONB kayıt/okuma sonrasında aynı kalır. Link kontrolünün boş numarayı yanlış kaynak değişikliği olarak görmesi giderildi.

## Bu turda uygulanmış sayılmayanlar

1. **E-fatura e-postasını bekleyip platformda belge varsa göndermeme.** Basit bir süre erteleme bu davranışın yerine konmadı. Sağlayıcıların mevcut fatura ilişkisinin salt okuma sözleşmesi ve gerçek hesap kabulü gerekir.
2. **Paraşüt/GİB resmî iptali ve uzaktaki taslağı iptal/silme.** Supsem gecikme açıklaması bunları da anlatıyor, fakat bizim yerel iptalimiz bunları çalıştırmaz. Resmî sözleşme ve mali uzlaştırma hâlâ ayrı iştir.
   Public API ve 2026 Paraşüt rehberlerinden bulunan tür/sonuç sınırları [iptal kaynaklarında](parasut-iptal-kaynaklar.md) kayıtlıdır; temel/ticari/e-arşiv aynı işlem olarak değerlendirilmez.
3. **Paraşüt'e otomatik tahsilat / ödeme yöntemi–kasa eşleme; irsaliye ve internet satışı alanlarının kalan kapsamı.** Görünen ayarlar tamamlandı olarak sayılmaz. Platformun alıcıdan tahsilatı, işletmenin banka hesabına ödeme gelmesiyle aynı olay değildir.
4. **İhracat kodu ve ihracatta erken faturalama.** İlk hedef Türkiye pazaryerleridir; dövizli yerel belge desteği tek başına ihracat/GİB akışı kabulü değildir. Genişletilmesi ayrıca kapsam/hesap kararı gerektirir.
5. Gerçek hesap, şirket geçişi, SMTP/PostgreSQL yük ve Coolify dağıtım kabulü. Test fikstürleri canlı ticari işlem yapmaz.

## Kabul dosyaları

- `tests/invoice-timing.test.ts`: beş zaman, tek fatura/tek stok çıkışı, ayar değişikliğinde eski siparişin korunması ve açık elle fatura.
- `tests/invoice-automation-server.test.ts`: tek varsayılan, aynı isteğin tekrarı, firma izolasyonu, bağlı işin başka hesaba taşınmaması, kapalı varsayılanda rastgele yedek seçmeme, mağaza özel hesabı ve çağrılar arasında kapatılan link anahtarı.
- `e2e/invoice-automation.spec.ts`: firma zamanı, iki test Paraşüt hesabı, varsayılan değiştirme, teslim anında otomatik taslak, mevcut belgenin bağlı hesabını koruma, link anahtarı ve mobil görünüm. Test firma hesapları, mevcut belirsiz-yanıt testinden ayrı sağlayıcı fikstürleri kullanır.

## Son kabul

- Genel alan/sunucu/adaptör koşusu **264 test / 37 dosya**, genel tarayıcı koşusu **23 akış** geçti. Son görünür alan etiketi ve stok uygunluğu kontrolünden sonra otomasyon ve çok-depo/döviz/yazdırma tarayıcı testleri ayrıca birlikte geçti.
- Frontend/server üretim derlemeleri, TypeScript, lint ve biçim denetimi başarılıdır. 390 px görünüm `C:\Users\hub\AppData\Local\Temp\opencode\pazarhub-core-review\invoice-automation-mobile.png` içinde saklandı.
- Yerel ekranlar: `/ecommerce-settings`, `/connections/invoice`, `/connections/marketplace`. Bunlar gerçek Paraşüt/GİB, mağaza, şirket verisi veya üretim dağıtımı kabulü değildir.
