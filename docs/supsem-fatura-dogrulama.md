# Bağımsız fatura, kategori ve tahsilat — Supsem karşılaştırması

25 Ekim 2026. Kullanıcının yenilediği oturumda Supsem'in Faturalar listesi, boş oluşturma formu, ödenmiş ve ödeme bekleyen fatura detayları, kategori yönetimi ve toplu ödeme penceresi incelendi. **Supsem üzerinde fatura, kategori, tahsilat, iptal, silme veya kaydetme çalıştırılmadı.** Bu belge gerçek müşteri verisini içermez.

## Kanıtlar

- Canlı yollar: `/dashboard/accounting/invoices`, `/dashboard/accounting/invoices/new`, mevcut fatura detayı.
- Resmî rehber: <https://supsem.com/yardim/faturalar-nasil-yonetilir>.
- Rehberin kapalı soru/cevap içeriğinde “Faturayı iptal ettim; stok ne olur?”: fatura iptalinde/silmede ürünlü satırların stokları geri yazılır.
- Sağlayıcı alanları: <https://apidocs.parasut.com/swagger.json>. Context7 kotası dolu olduğundan mevcut resmî OpenAPI kullanıldı.

| Gözlenen davranış | Bu turdaki uygulama |
|---|---|
| Siparişten bağımsız fatura oluşturma | `/finance/invoices/new`; fatura kendi müşteri/kalem/depo anlık görüntüsünü tutar. Sahte bir sipariş kaydı oluşturulmaz. |
| Müşteri, düzenleme tarihi, isteğe bağlı vade | Müşteri ve tarihler doğrulanır. Boş vade takibi yapılmaz. Aynı müşterinin fatura adresi sonraki müşteri kartı değişikliklerinde sessizce yeniden yazılmaz. |
| KDV hariç fiyat, yüzde/tutar indirimi | Yerel kalem hesabı önce faturanın para biriminde yapılır; fiyat/KDV/indirim ve yuvarlanan kalem toplamı saklanır. |
| Döviz seçilince kur alanı | TRY/USD/EUR/GBP; TCMB veya elle girilen sekiz ondalıklı kur. Fatura kuru katalog maliyet kurunu değiştirmez. TRY defter karşılığı ve özgün döviz tutarı dondurulur. |
| Katalog ürünü kayıtta stoktan düşer; serbest hizmet stok üretmez | Katalog kalemleri depo dağılımıyla düşülür. Paketlerde fiziksel bileşenler ve reçete dondurulur. Hizmet satırı stoktan düşmez. |
| Ödendi seçilince kasa girişi; yöntem/depo/tarih | Kayıt sırasında veya sonradan ödeme. Fatura ve tek bağlı kasa hareketi aynı işlemde kaydedilir. |
| Ödemeyi geri al | Yalnız bağlı kasa tahsilatı kaldırılır; başka kasa kaydı silinmez. Banka/hakediş eşlemesi veya geri ödemeli sipariş iadesi varsa önce ilgili kayıt uzlaştırılır. |
| Ödenmiş belgeyi düzenlemek için önce ödemeyi geri al | Yerel belge sürüm kontrolüyle düzenlenir. Fiyat/adet değişikliğinde eski stok dağılımı geri alınır ve yeni fark atomik uygulanır. Sağlayıcıya aktarılmış belge düzenlenmez. |
| Ödeme bekleyen yerel belgeyi iptal / geri al / sil | Bağımsız yerel faturada stok dönüşü/yeniden çıkış uygulanır; tekrar istek ikinci stok hareketi üretmez. Silme öncesi açık onay penceresi vardır. |
| Ödeme bekleyen / vadesi geçen / ödenen / iptal listesi | Fatura listesi arama, tarih, etiket, döviz tutarı ve ayrı TRY özetleriyle yenilendi. |
| Sipariş kaynaklı fatura ikinci satış değildir | Cari borç siparişten yalnız bir kez hesaplanır. Bağımsız fatura ayrı muhasebe kaynağıdır; sipariş raporuna sahte sipariş olarak eklenmez. |
| Kategori ekle, adına tıklayarak düzenle, pasife al, kullanılmıyorsa sil | Sürümlü kategori kataloğu, form/detay seçimi ve liste filtresi eklendi. Kullanılan kategori, iptal/ödenmiş faturada kullanılsa da silinmez; pasif kategori mevcut faturada kalabilir ama başka faturaya atanamaz. |
| Ödeme bekleyenleri seç → Ödendi işaretle | Aynı tarih/yöntem/depo ile toplu tahsilat eklendi. Ödenmiş, iptal veya iade/uzlaştırma bekleyen kaynaklar işlenmez. Fatura sürümü ve kalan tutar tek tek doğrulanır; biri değişmişse bütün işlem geri alınır. |
| Toplu ödeme penceresinde “siparişten kesilmiş faturada yalnızca siparişin henüz tahsil edilmemiş kısmı” | Yalnız fatura/sipariş referansına bağlı kasa kayıtları kalan tutardan düşülür; virman hariçtir. Genel cari tahsilat bir faturaya tahminen dağıtılmaz. Önceden tam tahsil edilmiş belgede ikinci veya sıfır tutarlı kasa girişi oluşturulmaz. |
| Resmileştirme kartında fatura linki, isteğe bağlı numara ve “Resmileştirildi (elle)” | Fatura detayına ve sipariş fatura penceresine dış belge bağlama eklendi. Link zorunlu, numara isteğe bağlıdır. İşlem yeni fatura kesmez; GİB doğrulaması yapmaz. |
| Elle resmileştirme işaretini kaldırma | Ayrı onayla yalnız dış belge ilişkisi kaldırılır; dışarıda kesilen resmî belge iptal edilmez. Gönderilmemiş pazaryeri link işi iptal edilir. Gönderilmiş/çalışan/belirsiz pazaryeri bağlantısı kontrolsüz kaldırılmaz. |
| Elle bağlı belgenin iptal açıklamasında “Resmi belge … kendiliğinden iptal EDİLMEZ” | Bağımsız faturanın yerel iptalinde dondurulmuş stok geri yazılır; dış belge ilişkisi korunur. Geri almada aynı dış belge ve stok dağılımı yeniden etkinleşir. Bu, Paraşüt/GİB iptali değildir. |

## Kategori ve tahsilat sınırları

- Toplu ödeme bir banka/kart işlemi değildir; muhasebe kaydıdır. Dövizli belgeler dondurulmuş TRY karşılığıyla aynı toplamada gösterilir ve kaydedilir.
- Son tahsilat geri alındığında yalnız o bağlı kasa hareketi kaldırılır; önceki kısmi tahsilatlar korunur. Eski fatura referanslı fakat müşteri kimliği eksik kayıtlar da doğru cariye dahil edilir.
- Bağımsız belgenin kısmi tahsilatı varken müşteri/kalem düzenlemesi veya silme, tahsilatı başka müşteriyle ilişkilendirmemek ve yetim kasa kaydı bırakmamak için engellenir. İlgili kasa kayıtları önce uzlaştırılmalıdır.
- Paraşüt aktarımında `item_categories` / `SalesInvoice` ve faturanın `category` ilişkisi kullanılır. Aynı adla birden fazla uzak kategori varsa rastgele seçilmez. Kaybolan kategori oluşturma yanıtı yalnız okuma yoluyla doğrulanır; kategori tekrar oluşturulmaz.
- Sağlayıcıya aktarılmış faturanın uzak kategori kimliği/adı saklanır. Yerel kategori adını değiştirmek daha önce aktarılmış mali belgenin kategorisini sessizce değiştirmez. Aktarım öncesi kategori değişirse iş kaynağı geçersizleşir.
- Toplu işlemde en fazla 100 fatura sınırı uygulamanın koruma sınırıdır; Supsem'de ölçülmüş bir üst sınır değildir.

## Paraşüt uyumu ve sınırlar

- Bağımsız ve sipariş kaynaklı faturalar aynı hazırlık/kuyruk/yanıt uzlaştırmasını kullanır. Faturanın müşterisi, kalemleri, para birimi, kayıtlı kuru ve tarihleri sağlayıcı sonucuyla karşılaştırılır.
- `issue_date` ve `due_date` resmî OpenAPI alanlarıdır. `invoice_no` salt okunurdur; yerel FT numarası bu alana sahte resmî numara olarak gönderilmez.
- Açıklama/notlar, desteklenen `description` alanında yerel referansla birlikte saklanır. Referans eşlemesi aynı faturanın kaybolan yanıtını ikinci kez oluşturmadan doğrular.
- “Yalnız iç kayıt” işaretli bağımsız fatura sağlayıcıya aktarılamaz. Yeni uygun belge, etkin/test edilmiş varsayılan veya mağaza özel hesabına ayrı kuyruk işiyle otomatik aktarılabilir; fatura detayından açık gönderim de yapılabilir. Veritabanına yerel fatura kaydetmek tek başına resmî belge değildir.
- Paraşüt'e aktarılmış veya Paraşüt tarafından resmileşmiş faturanın yerel iptal/silme düğmesi yoktur. Elle bağlanan dış belgede yalnız aşağıda açıklanan yerel iptal istisnası vardır; dış belge iptal edilmez. Sağlayıcıdaki taslak/resmî belge iptali ve ardından mali düzeltme **henüz bu turda kodlanmadı**. `sales_invoices/{id}/cancel` metodunun bulunması e-arşiv/GİB iptalinin tamamlandığı anlamına gelmez.
- **Elle belge bağlama bu turda uygulandı.** Yenilenen oturumda ödenmiş ve ödeme bekleyen belge kartları tekrar incelendi; link zorunluluğu, isteğe bağlı numara ve ayrı ödeme durumu doğrulandı. Yüklenmiş istemci kodunda işaret kaldırmanın link/numarayı temizlediği, elle bağlı belgenin düzenleme/silme kilidi ve dış resmî belgeyi iptal etmeyen yerel iptal açıklaması okundu. Supsem anahtarı değiştirilmedi ve gerçek kayıt kaydedilmedi.
- `Invoice.manualDocument` bağlantı adresi, isteğe bağlı dış numara, bağlama zamanı/yazarı ve önceki yerel durumu tutar. Paraşüt dış kimliği uydurulmaz; yerel FT numarası dış belgenin resmî numarası yerine konmaz. Dış belge bağlıyken düzenleme/silme ve Paraşüt oluşturma/resmileştirme/sorgulama kapalıdır.
- Bağlama müşteri/kalem/kur/depo/maliyet anlık görüntüsünü, stok hareketlerini ve tahsilatı değiştirmez. Sipariş kaynağı ile fatura sürümü yeniden doğrulanır; eski önizlemeyle link kaydedilmez. Yalnız iç kayıt veya sağlayıcıya zaten bağlanmış belgeye ikinci fatura atanmaz.
- Dış link sunucu tarafından indirilmez ve bu işlemde erişilebilirlik/GİB kontrolü yapılmış sayılmaz. HTTPS, kimlik bilgisi içermeyen genel alan adı ve güvenli port gerekir. Numara 64 karakter sınırı Supsem alanında da gözlendi. ToptanTR'nin ayrıca zorunlu tuttuğu numara boşsa link işi başarılı gösterilmez; diğer sağlayıcıların ayrı kabiliyetleri korunur.
- Desteklenen etkin/test edilmiş mağazada link iletimi kalıcı kuyruk işidir. Her sağlayıcı çağrısından önce sipariş/link/numara kaynak anahtarı doğrulanır. **Güvenlik farkı:** Supsem anahtarının aksine, bizde tamamlanmış/çalışan/belirsiz pazaryeri linki önce doğrulanmadan kaldırılamaz. Linki içeren yazma isteğinin başlatıldığı kalıcı iş yükünde ayrıca işaretlenir: yanıt kaybolup güvenli yeniden denemeye geçmiş olsa bile bağlantı kaldırılmaz. Yalnız henüz gönderilmemiş işin iptali ve bağlantının kaldırılması firma → iş kilidiyle atomiktir. Sağlayıcıya iletilmiş yanlış linki değiştirme/geri çekme kabulü bu yerel kaldırma işleminin kapsamında değildir.
- Mevcut Supsem hesabında Paraşüt bağlantısı yoktur; resmî belgenin sağlayıcı iptal onayı bu hesapta gözlenemedi. Yerel iptal hiçbir yerde GİB/e-belge iptali olarak sunulmaz. Firma fatura zamanı, varsayılan hesap ve otomatik link anahtarı eklendi; e-posta bekleme/uzak belge sorgusu ve ileri muhasebe seçenekleri [otomasyon doğrulamasında](supsem-fatura-otomasyon-dogrulama.md) ayrı sınırlarıyla kayıtlıdır.

## Güvenlik ve regresyon

- Fatura komutları `finance.write` ister; katalog stok etkisi olan oluşturma/düzenleme/iptal/geri alma/silme ayrıca `stock.write` ister.
- Firma satırı kilidi, komut makbuzu, fatura sürümü ve kuyruk denetimi birlikte kullanılır. Aynı kayıt isteği iki belge/iki ödeme oluşturmaz; devam eden/belirsiz Paraşüt işi varken belge değiştirilemez.
- Alan ve sunucu testleri: `tests/invoices.test.ts`, `tests/invoice-workflows.test.ts`, `tests/invoices-server.test.ts`, `tests/parasut-categories.test.ts`. Toplu komut makbuzunun eşzamanlı tekrarı tek tahsilat oluşturur; başka firma faturası tahsil edilemez. Kategori ataması stok izni istemez; stoklu faturadan son stok satırını kaldıran düzenleme ise stok izni ister.
- Dış belge testleri `tests/invoice-document.test.ts`, `tests/invoices-server.test.ts` ve `e2e/manual-invoice.spec.ts` içindedir. Bağlama/kaldırma mali hareket üretmez; yerel iptal/geri alma, stok ve dış belge ilişkisinin bütünlüğünü korur. Aynı komut tek link işi oluşturur, başka firmanın belgesine bağlanamaz ve Paraşüt çağrısı kimlik doğrulamadan önce engellenir.
- Tarayıcı testlerinin iki fatura hesabı sunucu başlangıcındaki gerçek kayıt akışından oluşan ayrı HTTP-only oturumları kullanır (`e2e/seeded-session.ts`). Üretimdeki 12 giriş / 5 dakika sınırı değiştirilmedi. Giriş ekranı ve oturum güvenliği ayrı tarayıcı/sunucu testlerinde hâlâ sınanır; `.data/e2e-sessions.json` yalnız geçici test oturumlarını içerir.
- Kalem sayısı/miktarı ve metin uzunluğunda mevcut uygulamanın koruma sınırları kullanılır. Bunlar Supsem'in ölçülmüş üst sınırları değildir.
- Son genel alan/sunucu/adaptör kabulü **264 test / 37 dosya**; son genel tarayıcı koşusu **23 akış** geçti. Kategori, toplu ödeme, dış belge ve Paraşüt uzlaştırma regresyonlarına fatura zamanı/varsayılan hesap/link anahtarı kabulü eklendi. Son görünüm/stok kontrolünden sonra otomasyon ve çok-depo/döviz/yazdırma testleri ayrıca birlikte geçti. Ayrıntılar [otomasyon doğrulamasında](supsem-fatura-otomasyon-dogrulama.md).
- Mobil test, yükleme iskeletinin değil gerçek başlığın/tablonun açılmasını bekler; liste ve kategori penceresi 390 px genişlikte kontrol edildi. Görseller `C:\Users\hub\AppData\Local\Temp\opencode\pazarhub-core-review\invoice-tools-mobile.png` ve `invoice-categories-mobile.png` içinde saklandı. Önceki bağımsız fatura görüntüsü aynı klasördedir.
- Elle bağlı belge detayının 390 px kontrolü de geçti; görüntü aynı klasörde `manual-invoice-mobile.png` olarak saklandı.
- Frontend/server üretim derlemeleri, TypeScript, lint ve biçim denetimi başarılıdır. Yerel `http://localhost:5173/finance/invoices` kullanılabilir; `/api/ready` veritabanı ve worker için hazır sonucunu verdi. Bunlar gerçek Paraşüt/müşteri verisi veya üretim ortamı kabulü değildir.
