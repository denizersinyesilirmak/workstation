# Workstation

Kişisel çalışma, satış/prim, todo ve müşteri takibi paneli. Veriler tarayıcıda `localStorage` içinde saklanır; sunucu veya hesap gerekmez.

## Özellikler

- **Genel bakış** — Bugün / bu hafta / bu ay veya özel tarih aralığına göre özet
- **Takvim** — Günün programı: çalışma, todo, satış; tamamlanan todolar da görünür
- **Çalışmalarım** — Günlük çalışma kayıtları ve toplam süre
- **Todo** — Planlama, tamamlama, sayaçla çalışma başlatma
- **Satışlar** — Prim hesabı ve ödeme durumu
- **Müşteriler & projeler** — Notlar, demo toplantısı takibi
- **Raporlar** — Çalışma raporu, CSV dışa aktarma
- **Ayarlar** — Saatlik ücret, hedefler, yedekleme / içe aktarma, tüm verileri silme
- Açık / koyu tema

## Yerelde çalıştırma

Statik bir site; herhangi bir HTTP sunucusu yeterli.

```bash
# Python
python -m http.server 5500

# veya Node
npx --yes serve -l 5500
```

Tarayıcıda: [http://localhost:5500](http://localhost:5500)

## Teknoloji

| Parça | Açıklama |
|--------|----------|
| HTML / CSS / JS | Bağımlılıksız tek sayfa uygulaması |
| Depolama | `localStorage` (`calismaKazancMvp.v2`) |

## Yedekleme

Ayarlar’dan JSON yedek alabilir veya geri yükleyebilirsiniz. Dışa aktarılan dosya adı: `denizwork-YYYY-MM-DD.json`.

## Lisans

Kişisel kullanım.
