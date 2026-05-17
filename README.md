# VegOps

VegOps, SRE olay müdahalesini çok ajanlı bir akışla yöneten yerel bir
uygulamadır. Next.js arayüzü, FastAPI backend üzerinden bir hedef servisin
sağlığını izler. Hedef servis 5xx durumuna geçtiğinde sistem otomatik olarak
olay kaydı açar, Rick ve Morty teknik değerlendirme yapar, Darwin tek bir
iyileştirme aracını seçer ve tüm süreç arayüzde canlı sohbet olarak akar.

Projenin amacı; olay algılama, ajanlar arası görev paylaşımı, onay eşiği,
araç çalıştırma, yeniden sağlık kontrolü ve olay sonrası raporlama adımlarını
uçtan uca göstermektir. Backend, ajan çağrılarını fal.ai OpenRouter uyumluluk
katmanı üzerinden yapar ve OpenAI chat-completions şemasını kullanır.

## Ekip

Ekibimiz: Vega

1. Çağrı Okan
2. Ali Hakan Ünal
3. Osman Selim Ilıca
4. Ata Baş
5. Abdurrahman Dıraz

## Repository İçeriği

Repository mutlaka şunları içermelidir:

- Tüm kaynak kodu
- Kapsamlı README
- Proje açıklaması ve amacı
- Kurulum talimatları
- Kullanım kılavuzu
- Kullanılan teknolojiler
- Ekip üyeleri
- Gerekli config dosyaları
- Örnek `.env` şablonu
- Gerçek API anahtarlarının repo'ya eklenmemiş olması

Ayrıntılı ajan davranışı için [AGENTS.md](AGENTS.md), teknik tasarım için
[DESIGN.md](DESIGN.md) dosyasına bakın.

## Özellikler

- Hedef servis sağlığını saniyelik aralıklarla izleme.
- 5xx algılandığında otomatik olay ve sohbet oluşturma.
- Rick, Morty ve Darwin ajanlarının sırayla olayı değerlendirmesi.
- Darwin kararının `page_devops`, `restart_server` veya `patch_code`
  araçlarından tam olarak birine dönüşmesi.
- Araç etki seviyesine göre otomatik çalıştırma veya arayüzden onay isteme.
- Sohbet, araç çağrıları, onaylar, loglar ve çözüm durumlarını SSE ile canlı
  yayınlama.
- Kapanan her olay için Customer Success, Developer, DevOps ve SRE ekiplerine
  ayrı rapor üretme.
- Raporları arayüzde görüntüleme ve PDF olarak indirme.
- Geçmiş sohbetlerde `@rick`, `@morty` ve `@darwin` mention desteği.

## Mimari

| Bileşen | Teknoloji | Port | Görev |
|---|---|---:|---|
| UI | Next.js 14 + TypeScript | 3000 | Dashboard, sohbet, onay akışı, raporlar, ayarlar |
| Backend | FastAPI + Python | 3001 | Sağlık kontrolü, olay döngüsü, ajan çağrıları, SQLite, SSE |
| Ajan runtime | fal.ai OpenRouter uyumlu endpoint | - | Rick, Morty ve Darwin mesajlarını üretir |
| Veritabanı | SQLite | - | Olay, sohbet, mesaj, araç çağrısı, log ve rapor verisini tutar |

UI, backend API'lerine `ui/next.config.js` içindeki rewrite ile
`/api/orch/*` üzerinden erişir. Doğrudan farklı bir backend adresine bağlanmak
için build sırasında `BACKEND_URL` verilir. Tarayıcı tarafında doğrudan çağrı
gerekiyorsa `NEXT_PUBLIC_ORCH_API_BASE` ve `NEXT_PUBLIC_ORCH_STREAM_BASE`
kullanılır.

## Ajanlar

| Ajan | Rol | Model |
|---|---|---|
| Rick | Kıdemli SRE bakışıyla olası nedeni inceler | `qwen/qwen-2.5-7b-instruct` |
| Morty | Rick'in değerlendirmesini kontrol eder ve en güvenli seviyeyi tartar | `qwen/qwen-2.5-7b-instruct` |
| Darwin | Rick ve Morty çıktısına göre tek aracı seçer | `deepseek/deepseek-v4-pro` |

Model kimlikleri `orchestrator/agents/runtime.py` içinde tutulur. Ajan sistem
prompt'ları `orchestrator/agents/prompts.py` dosyasındadır. Darwin'in araç
kararı tek satırlık JSON olarak gelir ve olay döngüsü bu JSON'u ayrıştırır.

## Araç Seviyeleri

Araçlar etki alanına göre sıralanır. Kullanıcının ayarladığı onay eşiğinin
üstündeki araçlar çalışmadan önce arayüzde onay bekler.

| Seviye | Araç | Endpoint | Etki |
|---:|---|---|---|
| 0 | `page_devops` | `POST /target/_control/page` | DevOps sayfası kaydeder; hata açık kalır |
| 1 | `restart_server` | `POST /target/_control/restart` | Aktif hatayı temizler; backend sürecini yeniden başlatmaz |
| 2 | `patch_code` | `POST /target/_control/patch` | Hedefi yamalanmış moda alır, hatayı temizler, sonraki hata aralığını uzatır |

Araç tanımları `orchestrator/agents/tools.py` dosyasındadır.

## Olay Akışı

1. Poller, ayarlı sağlık endpoint'ini düzenli olarak kontrol eder.
2. 5xx algılanırsa yeni olay ve olaya bağlı sohbet oluşturulur.
3. Rick ilk teknik teşhisi yazar.
4. Morty değerlendirmeyi çapraz kontrol eder.
5. Darwin tek bir araç seçen JSON kararını üretir.
6. Araç seviyesi izin eşiği içindeyse otomatik çalışır.
7. Araç seviyesi eşiğin üstündeyse sohbet içinde Approve veya Deny beklenir.
8. Araç çalıştıktan sonra backend tekrar sağlık kontrolü yapar.
9. Hata sürüyorsa ajan döngüsü en fazla dört denemeye kadar tekrar eder.
10. Hata çözülürse Darwin kısa post-mortem yazar ve olay kapatılır.
11. Sistem üç ekip raporu üretir ve raporlar sayfasında listeler.

Olay döngüsünün ana kodu `orchestrator/incident.py` dosyasındadır. Sağlık
kontrolünü başlatan poller `orchestrator/poller.py` içindedir. Hedef servis
durumu `orchestrator/target_state.py` tarafından yönetilir.

## Ön Gereksinimler

- Git
- Python 3.10 veya üzeri
- Node.js 18.17 veya üzeri
- npm
- Geçerli bir fal.ai API anahtarı
- Boşta olan `3000` ve `3001` portları

## Yerel Kurulum ve Çalıştırma

Repoyu klonlayın ve proje dizinine girin:

```bash
git clone <repo-url>
cd turksat-hackathon
```

Örnek ortam dosyasını kopyalayın:

```bash
cp .env.example .env
```

`.env` dosyasını açın ve gerçek `FAL_KEY` değerini girin:

```bash
FAL_KEY=your_fal_key_here
```

Gerçek API anahtarlarını `.env.example` içine yazmayın. `.env` dosyası
`.gitignore` tarafından dışarıda bırakılır ve repoya eklenmemelidir.

Backend'i başlatın:

```bash
# Terminal 1 - backend (port 3001)
cd orchestrator
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 3001
```

Yeni bir terminal açın ve UI'ı başlatın:

```bash
# Terminal 2 - UI (port 3000)
cd ui
npm ci
npm run dev
```

Tarayıcıda arayüzü açın:

```text
http://localhost:3000
```

## Kurulum Doğrulama

Backend çalışıyor mu kontrol edin:

```bash
curl http://localhost:3001/api/health-target
```

Hedef servis durumunu kontrol edin:

```bash
curl http://localhost:3001/target/health
curl http://localhost:3001/target/_debug/state
```

UI üzerinden backend erişimini kontrol etmek için `http://localhost:3000`
adresini açın. Dashboard hedef servis durumunu göstermelidir.

Yerel olay akışını test etmek için hata oluşturun:

```bash
curl -X POST http://localhost:3001/target/_debug/force-error
```

Bu istekten sonra arayüzde yeni olay açılmalı, ajan mesajları akmalı ve seçilen
araç onay eşiğine göre otomatik ya da kullanıcı onayıyla çalışmalıdır.

## Kullanım Kılavuzu

1. Dashboard sayfasında hedef servis sağlık durumunu izleyin.
2. Hata oluştuğunda sistem otomatik olay sohbeti açar.
3. Chats sayfasında Rick, Morty ve Darwin mesajlarını canlı takip edin.
4. Darwin'in seçtiği araç onay eşiğini aşıyorsa Approve veya Deny seçin.
5. Olay kapandıktan sonra Reports sayfasında ekip raporlarını inceleyin.
6. Logs sayfasında olay ve araç geçmişini kontrol edin.
7. Settings sayfasında sağlık endpoint'i ve onay seviyesini değiştirin.

## Dağıtım

Backend imajı:

```bash
cd orchestrator
docker build -t vegaops-backend .
docker run -p 3001:3001 --env-file ../.env vegaops-backend
```

UI imajı:

```bash
cd ui
docker build --build-arg BACKEND_URL=https://your-backend.example.com -t vegaops-ui .
docker run -p 3000:3000 -e PORT=3000 vegaops-ui
```

## Ortam Değişkenleri

| Değişken | Kullanıldığı yer | Açıklama |
|---|---|---|
| `FAL_KEY` | Backend | fal.ai OpenRouter uyumlu ajan çağrıları için zorunlu anahtar |
| `BACKEND_URL` | UI build zamanı | Next.js rewrite hedefini belirler |
| `NEXT_PUBLIC_ORCH_API_BASE` | UI runtime | Tarayıcıdan doğrudan API çağrısı için opsiyonel base URL |
| `NEXT_PUBLIC_ORCH_STREAM_BASE` | UI runtime | Tarayıcıdan doğrudan SSE bağlantısı için opsiyonel base URL |

## Çalışma Davranışı

- Backend açılışında olaylar, sohbetler, mesajlar, araç çağrıları, loglar ve
  raporlar temizlenir.
- Tarayıcı local storage kullanılmaz.
- Hedef servis hata zamanlayıcısı aktif olay varken durur.
- Olay çözüldüğünde veya terk edildiğinde raporlar oluşturulur ve zamanlayıcı
  yeniden çalışır.
- Bir olay en fazla dört araç denemesi yapar.
- Dört deneme sonunda sağlık düzelmezse olay çözülemedi olarak kapanır.
- `restart_server`, hedef servisteki aktif hatayı temizler; backend sürecini
  durdurup başlatmaz.

## UI Sayfaları

- Dashboard: hedef servis durumu, son olaylar ve canlı genel durum.
- Chats: olay sohbetleri, kullanıcı sohbetleri, mention akışı ve araç onayları.
- Reports: olay kapanınca üretilen ekip raporları ve PDF indirme.
- Logs: olay, araç ve sistem akışının zaman sıralı kayıtları.
- Settings: hedef sağlık endpoint'i ve araç onay seviyesi.

## Dizin Yapısı

```text
turksat-hackathon/
├── .env.example         # örnek ortam değişkenleri, gerçek anahtar içermez
├── .env                 # yerel ortam dosyası, repoya eklenmez
├── AGENTS.md            # ajan rolleri, modeller, araç seviyeleri
├── DESIGN.md            # teknik tasarım notları
├── orchestrator/        # FastAPI backend, ajan runtime, poller, SSE, SQLite
└── ui/                  # Next.js arayüzü
```
