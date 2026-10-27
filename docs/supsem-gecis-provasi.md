# Supsem şirket geçişi — temsili prova

Bu prova gerçek bir şirketin dışa aktarımı değildir. Kaynak ve hedef bakiyelerin uzlaşmasını sınamak için oluşturulmuş sentetik katalog kullanır. Dosya: [gecis-ornek-urunler.csv](gecis-ornek-urunler.csv).

## Kesim anı ve stok anlamı

Örnek şirketin kesim anındaki stok bakiyesi: beyaz havlu **10**, siyah havlu **7**, sabun **30**. Eski sistemde stok çıkışı uygulanmış fakat henüz sevk edilmemiş iki sipariş bulunur: 2 beyaz ve 1 siyah havlu.

Bu siparişler yeni sisteme onay bekler durumda alınacağı için geçiş dosyasına **12 / 8 / 30** hazırlanmış açılış bakiyesi yazılmıştır. Siparişler önce rezerve edilir; onaylanan siparişlerin çıkışı yalnız bir kez işlendiğinde stok yeniden **10 / 7 / 30** olur. Böylece eski sistemde düşülmüş miktar ikinci kez eksiltilmez.

Gerçek geçişte fiziksel bakiye, rezerve miktar ve stok çıkışı uygulanmış açık siparişler birlikte alınmalıdır. Dosya sütunundaki “stok”un satılabilir miktar mı, depo bakiyesi mi olduğu doğrulanmadan bu düzeltme yapılmaz. Geçiş bitene kadar pazaryerine otomatik stok/fiyat gönderimi kapalı tutulur; pazaryerindeki mevcut stok yeni açılış olarak tekrar içe alınmaz.

## Prova zinciri

1. CSV alanlarını eşle, modelden iki ürün/üç varyant oluştur; aynı dosyayı ikinci kez uygulamak yeni stok üretmez.
2. İki mağazanın uzak kataloğunu oku, altı mevcut ilanı SKU/barkodla üç yerel varyanta bağla. Aynı eşleme isteği yinelenince yeni ilan oluşmaz.
3. Açık siparişleri ve teslim edilmiş bir tarihsel kaydı iki kez oku; dış sipariş kimlikleri tekrar kaydı engeller. Tarihsel sipariş stok çıkışı üretmez.
4. Açık siparişleri onayla; aynı istek anahtarının tekrarı ikinci stok hareketi üretmez. Kesim anı stok bakiyesiyle karşılaştır.
5. Aktarılan satışlara ait borçlar hariç **1.500 TL** eski cari bakiyeyi açılış fişiyle kaydet. Aynı fiş/istek tekrarı ikinci borç veya kasa hareketi yaratmaz.
6. Son stokları iki mağazanın altı ilanına gönder; her mağazada **10 / 7 / 30** doğrulanır.

## Gerçek şirket için gereken dosyalar

- Ürün/model/varyant kimlikleri, SKU, barkod, KDV/para birimi, maliyet ve depo bazlı bakiyeler.
- Mağaza kimliği ve mevcut ilan/varyant uzak kimlikleri.
- Açık sipariş kalemleri, durumları, stok çıkışının uygulanıp uygulanmadığı, fatura/ödeme ilişkileri.
- Cari açılış ve kasa bakiyeleri; aktarılan satışların bu bakiyelere dahil olup olmadığı.

Prova `tests/migration-rehearsal.test.ts` ile gerçek uygulama API'si, veritabanı, içe aktarma, eşleme ve işleyici üzerinden çalışır. Sağlayıcı yanıtları yerel fikstürdür. Gerçek Supsem dışa aktarımıyla sütun/kimlik eşlemesi ve şirketin kesim tutanakları henüz kabul edilmedi.
