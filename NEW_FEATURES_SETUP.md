# Yeni keşif ve topluluk özellikleri

Bu değişiklik rota planlayıcı, fiziksel spot filtreleri, kişisel sürüş günlüğü,
toplulukta arama/etiketler, süreli anketler, çevrimdışı spot paketleri ve mükerrer
spot uyarısını mevcut tek sayfalı uygulamaya ekler. Bu dosya yeni veri alanlarının
kurulum sözleşmesini açıklar; gerçek çalışma sonuçları test çıktılarıyla ayrıca
kontrol edilmelidir.

## Yayın için gereken dosyalar

- `index.html`: güncel arayüz ve istemci işlemleri.
- `sw.js`: uygulama kabuğu ve izin verilen herkese açık statik bağımlılıklar için
  servis çalışanı. HTTPS veya localhost üzerinden sunulmalıdır.
- `firestore.rules`: mevcut profil/spot/duyuru yetkileri ve topluluk kurallarıyla
  birleştirilmiş **tam** dosya. Eski üretim kurallarını yedekleyip bu dosyanın
  tamamıyla değiştirin. GitHub'a dosya koymak Firebase kurallarını yayımlamaz.
- `community.firestore.indexes.json`: mevcut `spotId ASC + createdAt DESC`
  birleşik dizini korunur. Bu sürümde ek Firestore dizini gerekmez.

Kuralları yayımlamadan önce emülatör testlerini çalıştırın. Bu çalışma alanında
önceki emülatör indirmesi `storage.googleapis.com` erişiminde CONNECT 403 aldığı
ve yeni bir erişim değişikliği bilinmediği için yeni yetkilendirme testlerinin
çalıştığı varsayılmamalıdır. Testlerin sözdizimi kontrolü yalnızca test kaynağını
kontrol eder; Firestore kural derlemesi veya yetki davranışı doğrulaması değildir.

## İsteğe bağlı spot özellikleri

Eski `spots/{spotId}` kayıtlarında `features` alanının olmaması geçerlidir.
Yeni alan eklenirse aşağıdaki dört anahtar birlikte bulunur:

```json
{
  "features": {
    "difficulty": "intermediate",
    "dropHeight": 1.5,
    "landing": "wide",
    "surface": "concrete"
  }
}
```

- `difficulty`: `beginner`, `intermediate`, `advanced`, `unknown`.
- `dropHeight`: ölçülmemişse `null`; aksi halde 0–30 metre arası sayı.
- `landing`: `wide`, `medium`, `narrow`, `unknown`.
- `surface`: `concrete`, `asphalt`, `dirt`, `wood`, `mixed`, `unknown`.

Yalnızca spot sahibi veya doğrulanmış yönetici bu alanı ve açıklamayı günceller.
Sahip, koordinat, oluşturulma tarihi ve diğer temel alanlar bu işlemde değişmez.
Eski kayıtlarda bilinmeyen özellikler tahmin edilmemeli; filtrelenirken bu durum
arayüzde açıkça belirtilmelidir. Kullanıcı ölçümleri fiziksel güvenlik garantisi
olarak sunulmamalıdır.

## Anket veri sözleşmesi

Normal paylaşımlar değişmeden çalışır. Anketli bir paylaşımda isteğe bağlı `poll`
alanı bulunur:

```js
poll: {
  question: 'Hafta sonu hangi spot?',
  options: ['Bowl', 'Dirt', 'Urban'],
  endsAt: Timestamp, // UI: 1, 6, 24 veya 72 saat
  totalVotes: 0,
  counts: [0, 0, 0]
}
```

Soru 1–160, her seçenek 1–80 karakterdir. Boş veya aynı seçenekler reddedilir;
2–4 seçenek gerekir. İlk sayaçların tamamı sıfırdır. Tarayıcı saatinin ve ağ
gidişinin küçük farkları için oluşturulma anında sunucu 55 dakika ile 72 saat
5 dakika aralığını kabul eder. Oylamanın kapanışı tarayıcı saatine değil,
**sunucunun `request.time < endsAt` kontrolüne** bağlıdır.

Her kullanıcı için tek oy belgesi vardır:

```js
communityPosts/{postId}/votes/{uid}: {
  authorId: uid,
  option: 0, // seçenek indeksi
  createdAt: serverTimestamp()
}
```

İstemci tek atomik işlemde bu belgeyi oluşturur, paylaşımın yalnızca seçilen
sayacını ve `totalVotes` değerini bir artırır, `lastEvent` alanına
`{type:'vote', id:uid, actorId:uid}` yazar ve `communityRateLimits/{uid}` kaydını
`eventType:'vote', postId, eventId:uid, lastActionAt:serverTimestamp()` ile günceller.
Kurallar çocuk belgeyi ve sayaç değişimini karşılıklı doğrular. Doğrudan sayaç
şişirme, bir oyla birkaç seçeneği artırma, başka kullanıcı adına oy verme,
oy değiştirme/silme ve süresi bitmiş ankete oy verme reddedilir. Yeni olumlu
etkileşimler arasında mevcut 5 saniye sınırı korunur. Oy bildirim üretmez.

Oy belgeleri yalnızca kendi kullanıcısına okunur; oy verenlerin toplu listesi
okunamaz. Paylaşım içindeki toplam sonuçlar herkese açıktır. Soru, seçenekler ve
bitiş tarihi yayımdan sonra değiştirilemez. Kaldırılan paylaşıma yeni oy kapalıdır.

## Arama, yerel veriler ve çevrimdışı sınırlar

- Topluluk metin/etiket araması yüklenmiş paylaşımlar üzerinde çalışır. Tüm
  Firestore geçmişinde tam metin araması yaptığı iddia edilmemelidir; daha eski
  kayıtlar için sayfalama kullanılabilir.
- Rotalar ve günlük arayüzü saklama yerini açıkça göstermelidir. Bu cihazda
  saklanan veri başka cihazla otomatik eşitlenmiş sayılmaz. Özel günlük metni
  ancak kullanıcının açık paylaşım eylemiyle topluluk taslağına taşınır; otomatik
  yayımlanmaz. İlgili cihaz verilerini silmek bu kayıtları kaybettirebilir.
- Rota önizlemesindeki durak çizgisi gerçek yol ağı rotası değildir. Kuş uçuşu
  mesafe ve varsayılan sürüş hızıyla süre tahmini etiketlenir. Yol tarifleri
  harici navigasyon bağlantısıyla açılır.
- Çevrimdışı paket spot bilgilerini saklar. Google/Esri harita döşemeleri toplu
  indirilmez. İlk hazırlık çevrimiçi yapılır; servis çalışanının statik bağımlılık
  hazırlığı ve spot paketinin saklanması ayrı durumlar olarak gösterilmelidir.
- Firebase kimlik, Firestore veri istekleri ve kullanıcıya özel yanıtlar servis
  çalışanının herkese açık önbelleğine alınmaz.

## Yeni yetkilendirme testleri

`tests/next.rules.test.mjs` normal anket/oy işlemlerini, sayaç/kimlik/tarih
sahteciliğini, tekrar oyu, seçenek değişimini, özel oy okumalarını ve spot
özelliklerinin sahip yetkisini sınar. Mevcut 32 topluluk/legacy testiyle birlikte
aynı tam `firestore.rules` dosyasına karşı çalıştırılmalıdır. Dosyaları seri
çalıştırın; her dosya aynı yerel demo veritabanını temizler.

### Kaldırılan anketlerin içeriği

Paylaşım kaldırıldığında `text` boşaltılır ve `poll` alanı tamamen silinir.
Böylece ham paylaşım belgesi okunabilse de kaldırılmış anket sorusu ve seçenekleri
kamusal belgede kalmaz. Oy belgeleri değişmeden kullanıcıya özel kalır.
