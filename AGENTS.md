# Pazarhub — çalışma notları

Pazarhub, Supsem kullanan müşterilerin taşınacağı pazaryeri operasyon paneli. Menü, ekran ve iş akışları bilinçli olarak Supsem'e yakın tutulur; bilgi mimarisini kullanıcıya sormadan değiştirmeyin.

## Arayüz kuralları

Görünümle ilgili her değişiklikten önce [docs/tasarim-kurallari.md](docs/tasarim-kurallari.md) okunmalı. Özet:

- UI temeli HeroUI v3. Bileşen görünümü HeroUI'dedir; uygulama CSS'i yalnız yerleşim yazar.
- Renk, köşe, gölge ve yazı ailesi yalnız `src/styles/heroui-theme.css`'te.
- Yazı kalınlığı, harf aralığı, satır yüksekliği ve boşluk yalnız `src/styles/tokens.css`'teki `--app-*` token'larıyla. Sayfaya özel `px`, ara kalınlık (550, 610…) ya da yeni renk yazmayın.
- `npm run check:theme` bu kuralları denetler ve build/lint'in parçasıdır. Hata veriyorsa kuralı gevşetmeyin, değeri ölçeğe bağlayın.

## Komutlar

```sh
npm run dev:full      # arayüz :5173 + API :3001
npm run lint          # eslint + tema sözleşmesi
npm test              # vitest
npm run build:all
```

Node PATH'te değilse `scripts/project.ps1 -Task <görev>` taşınabilir Node'u bulur.
