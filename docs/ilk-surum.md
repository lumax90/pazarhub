# İlk çalışan sürüm

## Onaylanan yön

- React + Vite + TypeScript.
- HeroUI v3 görsel/etkileşim temeli; güncel sürüm 3.2.6.
- Framer Motion'un güncel paketi `motion`; React API'si `motion/react`.
- Supsem'e yakın menü isimleri ve ürün–varyant–mağaza ilanı ilişkisi.
- Sakin, okunabilir yüzeyler; sınırlı cam etkisi ve kısa geçişler.
- Harici e-ticaret sitesi bağlantıları dahil, araştırmada ertelenen modüller ilk kapsamda yok.

## Şu anda çalışan

Frontend ve örnek veri adaptörü hazır. Sipariş oluşturma/onay/tahsilat, ürün ve varyant düzenleme, mağaza özel ilan bilgisi, stok hareketi, perakende satış, müşteri ve finans görüntüleri aynı yerel veri modeliyle çalışır. Satır araması, filtre, sıralama, sayfalama, CSV, tema ve genel arama ortak bileşenlerle sunulur.

Siparişte fiyat, maliyet ve yeni sipariş adresi kayda kopyalanır. Sonraki katalog/adres değişikliği bu değerleri değiştirmez. Aynı siparişin tekrar onayı/tahsilatı ikinci hareket yaratmaz. Perakende, bekleyen siparişlerin rezervasyonunu tüketemez. Eksik stoklu çok satırlı işlem bütünüyle reddedilir.

## Teknik notlar

- Node.js 24 LTS ile çalıştırıldı. Bu bilgisayarda Node PATH'te bulunmadığından onaylı geçici alanda taşınabilir çalışma ortamı kullanıldı; `scripts/project.ps1` bunu da bulur.
- TypeScript 6.0.3, kullanılan TypeScript ESLint sürümünün desteklediği aralıkta seçildi.
- Sayfa modülleri ihtiyaç üzerine yüklenir.
- Ürün görselleri projeye ait yerel SVG çizimleridir; harici resim servisine bağımlılık yoktur.
- Form, tablo, durum ve para alanı desenleri `components/ui` altında ortaklaştırıldı.
- Geçici proje/marka adı Pazarhub; henüz nihai marka kararı verilmedi.

## Sonraki geliştirme kararı

Önce bu ilk görünüm ve iş akışı kullanıcıyla değerlendirilir. Ardından ilk pazaryerleri ve e-fatura sağlayıcısı seçilerek sunucu, kimlik doğrulama, çok kiracılı veri erişimi ve kalıcı entegrasyon işleyicileri geliştirilir. Gerçek platform anahtarları ve resmi belge işlemleri bu örnek tarayıcı adaptörüne eklenmez.
# Güncelleme — 23 Ekim 2026

Bu dosyanın aşağısı ilk frontend iterasyonunun tarihsel notudur. Sunucu, kalıcı veriler, roller, entegrasyon kuyruğu, ek stok/muhasebe ekranları ve Coolify paketi sonradan eklendi. Güncel durum ve kalan yayın maddeleri: [yayına hazırlık](yayin-hazirligi.md).
