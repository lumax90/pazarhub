# Coolify kurulumu

Paket `compose.yaml` üzerinden dört servis açar: **app**, **worker**, **database**, **backup**.

## Kurulum

1. Projeyi kendi Git deponuza ekleyin. Coolify'da **Application → Docker Compose** oluşturun; Compose dosyası `/compose.yaml`.
2. **Environment Variables** ekranında yalnız `PUBLIC_ORIGIN` zorunludur; boşken Coolify deploy'a izin vermez:

   ```dotenv
   PUBLIC_ORIGIN=https://panel.alanadiniz.com
   REGISTRATION_ENABLED=true
   INTEGRATION_NAME=Pazarhub
   ```

   Veritabanı parolası (`SERVICE_PASSWORD_POSTGRES`) ve şifreleme anahtarı (`SERVICE_HEX_64_ENCRYPTION`) Coolify tarafından bir kez üretilir ve saklanır; aynı ekranda görünürler. **Şifreleme anahtarını güvenli bir yere kopyalayın**: yedekten geri dönüşte bağlantı bilgilerini açmak için gerekir.

3. `app` servisine `https://panel.alanadiniz.com:3001` domainini atayın. `:3001` Coolify'ın servis içindeki hedef portudur; kullanıcı adresi standart HTTPS kalır. `PUBLIC_ORIGIN` bu adresin `:3001` olmayan halidir. DNS kaydını sunucuya yönlendirin.
4. Deploy edin. Migration uygulama açılışında işlem kilidi altında çalışır. API `/api/ready` ile veritabanını ve işleyici kalp atışını kontrol eder.
5. İlk hesabınızı oluşturun. Kapalı kullanım için ardından `REGISTRATION_ENABLED=false` yapın; ekip davetleri çalışmaya devam eder.
6. Bağlantılar ekranında hesap bilgilerini kaydedin, **Test et** işlemini çalıştırın, başarılı testten sonra gerekli otomasyonları açın.

Uygulama açılışta ayarları denetler ve eksik ya da hatalı değeri adıyla loglar (ör. `PUBLIC_ORIGIN is not a URL: "…"`). Yeni kurulumda ilk deploy yanlış parolayla açıldıysa, veri girmeden önce **database** servisinin volume'ünü silip yeniden deploy edin: PostgreSQL parolayı yalnız boş volume'de ilk açılışta kaydeder.

Eşzamanlı API örneği sayısını ilk kurulumda **1** tutun; oturumlar veritabanındadır, HTTP istek sınırlayıcısı süreç belleğindedir. Her worker kendi container adıyla kalp atışı verir. API ile worker aynı `ENCRYPTION_KEY` ve `DATABASE_URL` değerlerini kullanmalıdır.

## E-posta

Parola yenileme için:

```dotenv
SMTP_HOST=smtp.saglayiciniz.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=hesap
SMTP_PASSWORD=parola
MAIL_FROM=Pazarhub <noreply@alanadiniz.com>
```

465 portunda `SMTP_SECURE=true` kullanın. 587'de STARTTLS zorunludur. Kullanıcı davetleri tek kullanımlık bağlantı olarak kopyalanabilir.

## Veriler ve yedek

- PostgreSQL named volume'ü tüm kayıtları saklar. Ürün görselleri, fatura PDF'leri ve etiketler de veritabanındadır.
- `backup` günlük `pg_dump` alır. `database-backups` volume'ünde varsayılan 30 gün tutulur; `BACKUP_RETENTION_DAYS` ile değişir.
- Şifreli bağlantı bilgilerini geri açmak için yedekle birlikte **aynı şifreleme anahtarı** (`SERVICE_HEX_64_ENCRYPTION`) de korunmalıdır. Anahtar veritabanı dump'ına dahil değildir.
- Coolify'ın volume/yedek yönetimi üzerinden dump dosyalarını sunucu dışına kopyalayın.
- Geri yükleme: app ve worker durdurulmuşken boş PostgreSQL veritabanına `pg_restore --no-owner --no-acl -U pazarhub -d pazarhub /yedek.dump`; ardından aynı anahtarla servisleri başlatın.

## Kontrol adresleri

- `/api/health`: API çalışıyor mu?
- `/api/ready`: veritabanı ve worker hazır mı?
- `/jobs`: kuyruk, tekrarlar ve sağlayıcı sonuçları.

Gerçek hesapla sipariş alma, stok/fiyat güncelleme, gönderi/etiket ve fatura kabulü ayrıca yapılmalıdır. Yerel otomatik testler gerçek sağlayıcı kabulü değildir. Sağlayıcı kapsamı ve açık maddeler: [yayına hazırlık](yayin-hazirligi.md).
