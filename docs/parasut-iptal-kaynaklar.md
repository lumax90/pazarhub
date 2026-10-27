# Paraşüt iptali — açık sözleşme sınırı

25 Ekim 2026. Public OpenAPI ve Paraşüt kullanım kılavuzu/blog kaynakları okundu; gerçek Paraşüt/GİB kaydı üzerinde işlem yapılmadı. Context7 aylık kotası dolu olduğundan doğrudan resmî kaynaklar kullanıldı.

## Kaynaklar

- <https://apidocs.parasut.com/swagger.json>: `DELETE /{company_id}/sales_invoices/{id}/cancel`; açıklama boş. Aynı şemada `e_archives` için `cancellable_until` salt okunur, durum enum'u `bounced/sent/printed/legalized`. Ayrı bir e-belge iptal/itiraz uç sözleşmesi yok.
- <https://www.parasut.com/kullanim-kilavuzu/elektronik-faturada-iptal-iade-islemleri> — 3 Şubat 2026 güncellemesi: ticari e-faturada alıcı reddi, temel e-faturada iade/mahsuplaşma; Paraşüt'te iptal düğmesi e-arşiv için örneklenir. Elektronik faturada yerinde düzenleme yapılamaz.
- <https://www.parasut.com/blog/e-fatura-nasil-iptal-edilir> — 13 Mayıs 2026: fatura senaryosuna göre ret/talep/karşı taraf onayı ve süre sonrası iade süreçleri ayrılır.
- <https://www.parasut.com/blog/e-arsiv-fatura-nasil-iptal-edilir>: e-arşiv iptali ve GİB raporlaması ayrı aşamalardır; kullanım kılavuzuna bağlanır.

## Uygulama kararı

- `sales_invoices.cancel` metodunun 200 dönmesi tek başına bütün temel/ticari e-faturaların resmen iptal olduğunu kanıtlamaz. Yerel `Invoice.status='cancelled'`, Paraşüt muhasebe kaydının iptali ve GİB/karşı tarafın resmî belge sonucu ayrı tutulmalıdır.
- Sağlayıcının kendi kaynaklarında 7/8 günlük anlatımlar ve farklı başlangıç tarihleri var. Genel blog metninden sabit bir “her fatura bu kadar günde iptal edilir” kuralı kodlanmadı. Belgenin sağlayıcıdan gelen türü, senaryosu ve `cancellable_until` gibi somut alanlar esas alınmalı; süre/sonuç anlamı kabulde doğrulanmalıdır.
- Yerel iptal, dışarıda elle kesilmiş belge iptali değildir. Paraşüt/GİB resmî iptali, karşı taraf reddi/itirazı ve mali düzeltme bu turda uygulanmış sayılmaz.
- Devam için: API iptal çağrısının **e-arşivde** resmî belge ve muhasebe kaydı üzerindeki etkisinin, iptal sonrası okunabilir kimlik/sonuç alanlarının ve kaybolan yanıt kurtarmasının yetkili test hesabında/sözleşmesinde doğrulanması gerekir. Temel/ticari e-fatura ve iade faturası ayrı akışlardır; tek genel iptal düğmesiyle aynı sayılmaz.
