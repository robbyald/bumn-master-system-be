# Blueprint Soal TKD - Verbal Logical Reasoning (VLR)

## Tujuan
Membuat 1 soal penalaran verbal yang menguji kemampuan menyimpulkan fakta berdasarkan data/aturan yang diberikan, tanpa asumsi di luar teks.

## Struktur Output (JSON) — WAJIB DIPISAH
{
  "context_text": "Paragraf fakta/angka/aturan. HANYA data mentah, tanpa kesimpulan.",
  "statement_to_judge": "Satu kalimat klaim yang akan dinilai kebenarannya.",
  "options": [
    "Simpulan adalah benar",
    "Simpulan adalah salah",
    "Tidak dapat disimpulkan"
  ],
  "correctAnswer": "A|B|C",
  "explanation": "Penjelasan singkat, konsisten dengan correctAnswer."
}

## ATURAN MUTLAK (CRITICAL)
- `context_text` HANYA berisi DATA/FAKTA/ATURAN. **DILARANG** menutup dengan rangkuman/kesimpulan.
- **HARAM** memakai kata/frasa kesimpulan dalam `context_text`: "Oleh karena itu", "Dengan demikian", "Dapat disimpulkan", "Kesimpulannya", "Sehingga dapat".
- `statement_to_judge` harus klaim langsung (tanpa awalan seperti "Simpulan bahwa" / "Oleh karena itu").
- Jika informasi TIDAK disebut di teks, jawabannya **C (Tidak dapat disimpulkan)**. Dilarang menggunakan asumsi dunia nyata.
- `explanation` HARUS selaras dengan `correctAnswer`. Kalimat akhirnya menyatakan status: "Simpulan adalah benar/salah/tidak dapat disimpulkan".
- **Anti-Incomplete Category (Wajib):** Jika `statement_to_judge` memakai kata **"semua"** tentang atribut tertentu (mis. diskon/izin/kelulusan), maka `context_text` WAJIB menyebut status atribut itu untuk **seluruh kelompok**, termasuk bagian “sisa/lainnya”. Jika ada kata “sisa/lainnya/sisanya” tanpa status atributnya, jawaban harus **C**.

## Aturan Logika, Matematika & Anti-Halusinasi (WAJIB DITAATI)
- **LARANGAN MUTLAK HIMPUNAN VENN (IRISAN):** DILARANG KERAS membuat skenario yang tumpang tindih atau beririsan (Contoh HARAM: "10 orang menyukai A dan B sekaligus", "bekerja di kedua divisi"). Semua kategori kelompok dalam soal HARUS saling lepas (*Mutually Exclusive*).
- **Gunakan Logika Kategorial & Persentase:** Lebih baik buat soal berbasis Persentase bertingkat (Misal: 60% karyawan wanita, 20% dari wanita tersebut dapat promosi), aturan bersyarat (Jika-Maka), atau Subset murni.
- **Anti-Paradoks Aturan:** Dilarang memasukkan aturan yang saling menggugurkan di dalam teks. (Contoh HARAM: "Ada 20 orang di dua divisi. Setiap orang hanya boleh punya 1 divisi").
- **Validasi Hukum Total:** Jika menyebutkan angka "Total", PASTIKAN jumlah rinciannya pas. Lakukan rekalkulasi penjumlahan/pengurangan di "kepala" Anda sebelum menulis `explanation`!
- Tidak boleh ada hasil desimal untuk jumlah entitas (manusia/barang).
- Hindari operasi multi-langkah yang rumit; cukup 1–2 langkah hitung dasar.

## Gaya Bahasa
- Bahasa Indonesia formal, jelas, ringkas.
- Panjang konteks wajar (3–6 kalimat).
- Hindari kata-kata opini atau penilaian.
- **Variasi pola soal wajib** (rotasi): silogisme, kausalitas, urutan/posisi, kategori, kuantitatif, ambiguitas.
- Dalam batch kecil, jangan mengulang pola yang sama berturut-turut.

## Contoh Output (Bentuk)
{
  "context_text": "Di sebuah kelas ada 40 siswa. 25 siswa menyukai Matematika, 20 menyukai Fisika, dan 5 siswa tidak menyukai keduanya.",
  "statement_to_judge": "Terdapat tepat 10 siswa yang menyukai Matematika sekaligus Fisika.",
  "options": ["Simpulan adalah benar", "Simpulan adalah salah", "Tidak dapat disimpulkan"],
  "correctAnswer": "A",
  "explanation": "Total yang menyukai setidaknya satu pelajaran adalah 35. Irisan = 25 + 20 - 35 = 10. Simpulan adalah benar."
}
